// Opt-in: requires an EMPTY throwaway local PostgreSQL database named *_draft_test.
// Refuses remote hosts and never reads Supabase environment variables.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const connectionString=process.env.LOCAL_DRAFT_TEST_DB_URL;
if(!connectionString)throw new Error('Set LOCAL_DRAFT_TEST_DB_URL to an empty localhost *_draft_test database.');
const url=new URL(connectionString);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||url.search||!/^\/[a-z0-9_]+_draft_test$/.test(url.pathname))
  throw new Error('Only an explicit local disposable *_draft_test database is allowed; no URL query overrides.');
const clients=Array.from({length:3},()=>new pg.Client({connectionString}));
const [admin,a,b]=clients;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
  for(const c of clients){await c.connect();await c.query("set statement_timeout='8s'");}
  const tables=(await admin.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n;
  if(tables)throw new Error('Database is not empty; refusing to modify it.');
  await admin.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL(f,dir),'utf8'));
  const actor=randomUUID();
  await admin.query('insert into auth.users values($1)',[actor]);
  await admin.query("insert into draft.league_roles values($1,'commissioner')",[actor]);
  const owners=(await admin.query("select id from draft.owners where slug in ('doug','chris') order by slug desc")).rows;
  await admin.query('insert into draft.owner_accounts values($1,$2)',[actor,owners[0].id]);
  const imp=(await admin.query("insert into draft.player_pool_imports(checksum,schema_version,status,completed_at) values(repeat('c',64),1,'staging',now()) returning id")).rows[0].id;
  const d=(await admin.query("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,import_id) values('race','free_agent',2027,1,2,$1) returning id",[imp])).rows[0].id;
  const players=[];
  for(let i=0;i<2;i++){
    const p=(await admin.query("insert into draft.players(sport,name) values('NFL','race player') returning id")).rows[0].id;
    const src=(await admin.query("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'test','test',$2) returning id",[p,String(i)])).rows[0].id;
    await admin.query("insert into draft.player_pool_entries values($1,$2,$3,'NFL','race player',null,null,'free_agent')",[imp,p,src]);
    await admin.query("insert into draft.draft_pool_players values($1,$2,$3,'NFL','race player',null,null,'free_agent',true)",[d,imp,p]);
    players.push(p);
  }
  await admin.query("update draft.player_pool_imports set status='ready' where id=$1",[imp]);
  await admin.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const command=(c,rev,action,args,request=randomUUID())=>c.query('select draft.command($1,$2,$3,$4,$5) result',[d,request,rev,action,JSON.stringify(args)]);
  await command(admin,0,'set_order',{owners:owners.map(x=>x.id)});
  await command(admin,1,'set_timer',{seconds:600});
  await command(admin,2,'start',{});
  const slots=(await admin.query('select id,current_owner_id from draft.draft_picks where draft_id=$1 order by overall_pick_number',[d])).rows;
  for(const c of [a,b]){
    await c.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await c.query('set role authenticated');
  }
  const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  async function assertBlocked(){
    for(let n=0;n<30;n++){
      const row=(await admin.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
      if(row?.wait_event_type==='Lock')return;
      await wait(50);
    }
    throw new Error('Contender did not block on the draft lock');
  }
  await a.query('begin');
  const req=randomUUID(), args={pick_id:slots[0].id,player_id:players[0]};
  const winner=(await command(a,3,'pick',args,req)).rows[0].result;
  await b.query('begin');
  const pending=command(b,3,'pick',{pick_id:slots[0].id,player_id:players[1]})
    .then(()=>({ok:true}),error=>({error}));
  await assertBlocked();
  await a.query('commit');
  const loser=await pending;
  assert.match(loser.error?.message??'',/Draft changed/);
  await b.query('rollback');
  const retry=(await command(b,3,'pick',args,req)).rows[0].result;
  assert.deepEqual(retry,winner);
  assert.equal((await admin.query('select count(*)::int n from draft.draft_selections')).rows[0].n,1);
  console.log('PASS two independent sessions: same-slot race, lock wait, stale revision rejection, idempotent retry');

  // Test the unique-player backstop with trusted SQL, independent of command
  // revision checking. Session A releases then reclaims a player before commit.
  await a.query('reset role');await b.query('reset role');
  await a.query('begin');
  await a.query("update draft.draft_selections set voided_at=clock_timestamp(),void_reason='race test' where voided_at is null");
  const insert=(c,slot)=>c.query("insert into draft.draft_selections(draft_id,pick_id,owner_id,player_id,sport,method) values($1,$2,$3,$4,'NFL','commissioner')",[d,slot.id,slot.current_owner_id,players[0]]);
  await insert(a,slots[0]);
  await b.query('begin');
  const duplicate=insert(b,slots[1]).then(()=>({ok:true}),error=>({error}));
  await assertBlocked();await a.query('commit');
  assert.equal((await duplicate).error?.code,'23505');await b.query('rollback');
  console.log('PASS two independent sessions: duplicate-player race rejected by unique index');
  console.log('Tests leave data in the disposable local database for inspection. No automatic deletion.');
}finally{
  for(const c of clients){try{await c.query('rollback');}catch{}try{await c.end();}catch{}}
}
