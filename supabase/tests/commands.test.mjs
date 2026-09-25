import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const db=await PGlite.create();
const q=async(s,p=[])=>(await db.query(s,p)).rows;
let tests=0;
async function test(name,fn){await fn();tests++;console.log('PASS '+name);}
const doug=randomUUID(), other=randomUUID(), outsider=randomUUID();
let draftId, owners, players;
async function call(action,args={},who=doug, revision=null,request=randomUUID()) {
  const rev=revision??Number((await q('select revision from draft.drafts where id=$1',[draftId]))[0].revision);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[who??'']);
  await db.exec('set role authenticated');
  try{return (await q('select draft.command($1,$2,$3,$4,$5) result',[draftId,request,rev,action,JSON.stringify(args)]))[0].result;}
  finally{await db.exec('reset role');}
}
async function slots(){return q('select * from draft.draft_picks where draft_id=$1 order by overall_pick_number',[draftId]);}
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  owners=await q("select id from draft.owners where slug in ('doug','chris') order by slug desc");
  await q('insert into auth.users values($1),($2),($3)',[doug,other,outsider]);
  await q('insert into draft.owner_accounts values($1,$2),($3,$4)',[doug,owners[0].id,other,owners[1].id]);
  await q("insert into draft.league_roles values($1,'commissioner')",[doug]);
  const imp=(await q("insert into draft.player_pool_imports(checksum,schema_version,status,completed_at) values(repeat('b',64),1,'staging',now()) returning id"))[0].id;
  draftId=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,import_id) values('commands','free_agent',2027,2,2,$1) returning id",[imp]))[0].id;
  await q("insert into draft.draft_sport_rules values($1,'NFL',1,null),($1,'PGA',1,null)",[draftId]);
  players=[];
  for(const sport of ['NFL','NFL','PGA','PGA','NFL']){
    const id=(await q('insert into draft.players(sport,name) values($1,$2) returning id',[sport,`Test ${players.length}`]))[0].id;
    const source=(await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'fixture','fixture',$2) returning id",[id,String(players.length)]))[0].id;
    await q("insert into draft.player_pool_entries(import_id,player_id,source_id,sport,name,availability) values($1,$2,$3,$4,$5,'free_agent')",[imp,id,source,sport,`Test ${players.length}`]);
    await q("insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,availability,eligible) values($1,$2,$3,$4,$5,'free_agent',true)",[draftId,imp,id,sport,`Test ${players.length}`]);
    players.push(id);
  }
  await q("update draft.player_pool_imports set status='ready' where id=$1",[imp]);
  await test('unauthenticated and outsiders rejected',async()=>{
    await assert.rejects(()=>call('start',{},null),/Authentication/);
    await assert.rejects(()=>call('start',{},outsider),/access denied/);
  });
  await test('commissioner configures order and timer; start validates requirements',async()=>{
    await call('set_order',{owners:owners.map(o=>o.id)});
    await assert.rejects(()=>call('set_timer',{seconds:60},other),/Commissioner/);
    await assert.rejects(()=>call('start'),/timer/);
    await call('set_timer',{seconds:300});
    const result=await call('start');assert.equal(result.status,'running');
    assert.deepEqual((await slots()).map(s=>s.current_owner_id),[owners[0].id,owners[1].id,owners[1].id,owners[0].id]);
  });
  await test('only current owner picks; idempotent retry preserves one selection',async()=>{
    const s=(await slots())[0],req=randomUUID();
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[0]},other),/on the clock/);
    const rev=Number((await q('select revision from draft.drafts where id=$1',[draftId]))[0].revision);
    const result=await call('pick',{pick_id:s.id,player_id:players[0]},doug,rev,req);
    assert.deepEqual(await call('pick',{pick_id:s.id,player_id:players[0]},doug,rev,req),result);
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[1]},doug,rev,req),/different command/);
    await assert.rejects(()=>call('pause',{},doug,rev),/Draft changed/);
    assert.equal(Number((await q('select count(*) n from draft.draft_selections'))[0].n),1);
  });
  await test('duplicate player rejection rolls back revision and command record',async()=>{
    const s=(await slots())[1];
    const before=await q('select revision from draft.drafts where id=$1',[draftId]);
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[0]},other),/unique/);
    assert.deepEqual(await q('select revision from draft.drafts where id=$1',[draftId]),before);
  });
  await test('pause blocks owner; timer change preserves current remaining time',async()=>{
    await call('pause');
    const s=(await slots())[1];
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[1]},other),/current running/);
    const before=(await q('select paused_remaining_seconds from draft.drafts where id=$1',[draftId]))[0];
    await call('set_timer',{seconds:600});
    assert.deepEqual((await q('select paused_remaining_seconds from draft.drafts where id=$1',[draftId]))[0],before);
    await call('resume');
  });
  await test('deadline prevents late picks; expiration advances once and leaves unfilled slot',async()=>{
    const s=(await slots())[1];
    await assert.rejects(()=>call('expire',{pick_id:s.id},other),/not expired/);
    await q("update draft.drafts set deadline_at=clock_timestamp()-interval '1 second' where id=$1",[draftId]);
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[1]},other),/deadline expired/);
    await call('expire',{pick_id:s.id},other);
    assert.ok((await slots())[1].skipped_at);
    await assert.rejects(()=>call('expire',{pick_id:s.id},other),/current running/);
  });
  await test('commissioner fills skipped slot without consuming current turn',async()=>{
    const s=(await slots())[1];
    await assert.rejects(()=>call('assign',{pick_id:s.id,player_id:players[1]},other),/Commissioner/);
    const r=await call('assign',{pick_id:s.id,player_id:players[1]});
    assert.equal(r.current_pick_number,3);
  });
  await test('minimum feasibility rolls back forbidden selection',async()=>{
    const s=(await slots())[2];
    await assert.rejects(()=>call('pick',{pick_id:s.id,player_id:players[4]},other),/minimums/);
    await call('pick',{pick_id:s.id,player_id:players[2]},other);
  });
  await test('latest undo while paused releases player and preserves turn',async()=>{
    await call('pause');
    const sels=await q('select id from draft.draft_selections where draft_id=$1 and voided_at is null order by selected_at',[draftId]);
    await assert.rejects(()=>call('undo',{selection_id:sels[0].id,reason:'test'}),/latest/);
    await call('undo',{selection_id:sels.at(-1).id,reason:'Test correction'});
    assert.equal((await q('select current_pick_number from draft.drafts where id=$1',[draftId]))[0].current_pick_number,4);
    await call('resume');
    await call('pick',{pick_id:(await slots())[3].id,player_id:players[3]});
    assert.equal((await q('select status from draft.drafts where id=$1',[draftId]))[0].status,'awaiting_makeups');
    const result=await call('assign',{pick_id:(await slots())[2].id,player_id:players[2]});
    assert.equal(result.status,'completed');
  });
  await test('no direct table writes or helper bypass; anonymous cannot invoke command',async()=>{
    await db.exec('set role authenticated');
    try{await assert.rejects(()=>db.exec(`select draft.advance_clock('${draftId}')`),/permission denied/);
      await assert.rejects(()=>db.exec('update draft.drafts set revision=999'),/permission denied/);
    }finally{await db.exec('reset role');}
    await db.exec('set role anon');
    try{await assert.rejects(()=>db.query('select draft.command($1,$2,0,\'start\')',[draftId,randomUUID()]),/permission denied/);}
    finally{await db.exec('reset role');}
  });
  await test('completed draft can be corrected through an audited makeup slot',async()=>{
    const sel=(await q("select s.id from draft.draft_selections s join draft.draft_events e on e.payload->'selection'->>'id'=s.id::text and e.event_type='selection' where s.draft_id=$1 and s.voided_at is null order by e.id desc limit 1",[draftId]))[0];
    const result=await call('undo',{selection_id:sel.id,reason:'Correction after completion'});
    assert.equal(result.status,'awaiting_makeups');
    await call('assign',{pick_id:(await slots())[2].id,player_id:players[2]});
  });
  console.log(`${tests} command tests passed; no hosted database contacted.`);
}finally{await db.close();}
