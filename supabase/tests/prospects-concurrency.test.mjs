import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import {scoringTestConfig} from './scoring-test-config.mjs';
const clients=Array.from({length:3},()=>new pg.Client(scoringTestConfig(process.env.LOCAL_SCORING_TEST_DB_URL))),[db,a,b]=clients;
const one=async(c,s,p=[])=>Object.values((await c.query(s,p)).rows[0])[0];
try{
 for(const c of clients){await c.connect();await c.query("set statement_timeout='15s';set idle_in_transaction_session_timeout='30s'");}
 assert.equal(await one(db,"select count(*)::int from pg_tables where schemaname not in ('pg_catalog','information_schema')"),0,'Empty disposable database required');
 await db.query("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.query(await readFile(new URL(f,dir),'utf8'));
 const user=uuid(),owner=await one(db,"select id from draft.owners where slug='doug'");await db.query('insert into auth.users values($1)',[user]);await db.query('insert into draft.owner_accounts values($1,$2)',[user,owner]);await db.query("insert into draft.league_roles values($1,'commissioner')",[user]);
 for(const c of [db,a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 const command=(c,req,action,args)=>one(c,'select public.prospect_command($1,$2,$3)',[req,action,JSON.stringify(args)]);
 const args={owner_id:owner,sport:'NFL',name:'Concurrency prospect',fantrax_id:'race01',reason:'Synthetic prospect race'};
 const pidA=await one(a,'select pg_backend_pid()'),pidB=await one(b,'select pg_backend_pid()');
 async function race(first,second){
  await a.query('begin');await a.query('select pg_advisory_xact_lock(731943,1)');
  const x=await first();let y;
  const pending=second().then(value=>({value}),error=>({error}));
  try{let blocked=false;for(let i=0;i<100;i++){if(await one(db,'select $1=any(pg_blocking_pids($2))',[pidA,pidB])){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(blocked,'Observed real lock wait required');await a.query('commit');y=await pending;}finally{await a.query('rollback');}
  return [x,y];
 }
 const req=uuid();let [p,retry]=await race(()=>command(a,req,'add',args),()=>command(b,req,'add',args));assert.ifError(retry.error);assert.deepEqual(retry.value,p);
 assert.equal(await one(db,'select count(*)::int from trading.prospects'),1);
 console.log('PASS independent sessions: duplicate prospect request waits and returns one audited addition');
 const owners=(await db.query('select slug from draft.owners where active')).rows;
 const roster=JSON.stringify(owners.map(o=>({owner:o.slug,players:o.slug==='doug'?[{player_id:'race01',name:'Concurrency prospect'}]:[]})));
 const observed=await one(db,'select clock_timestamp()::text');
 const result=await race(()=>a.query("select trading.ingest_rosters('NFL','race-nfl',$1,$2,false)",[observed,roster]),()=>command(b,uuid(),'remove',{id:p.id,revision:p.revision,reason:'Queued removal after import'}));
 assert.match(result[1].error?.message??'',/changed/);assert.equal(await one(db,'select status from trading.prospects'),'confirmed');
 console.log('PASS independent sessions: Fantrax confirmation rejects stale queued removal, counts player once');
 const fresh=await command(db,uuid(),'add',{...args,name:'Second prospect',fantrax_id:'race02'});
 const req2=uuid();const removed=await race(()=>command(a,req2,'remove',{id:fresh.id,revision:1,reason:'Removal before roster import'}),()=>b.query("select trading.ingest_rosters('NFL','race-nfl',clock_timestamp(),$1,false)",[JSON.stringify(owners.map(o=>({owner:o.slug,players:o.slug==='doug'?[{player_id:'race01',name:'One'},{player_id:'race02',name:'Two'}]:[]})))]));
 assert.ifError(removed[1].error);assert.equal(await one(db,'select status from trading.prospects where id=$1',[fresh.id]),'removed');
 assert.equal(Number((await one(db,'select public.prospect_rosters()')).owners.find(o=>o.id===owner).total),2);
 console.log('PASS independent sessions: removal first does not delete subsequent Fantrax ownership or reactivate prospect');
 const own=await command(db,uuid(),'add',{...args,name:'Owner drop race',fantrax_id:'race03'});
 const dropReq=uuid();
 const drop=c=>one(c,'select public.drop_own_prospect($1,$2,1,true)',[dropReq,own.id]);
 const [dropped,duplicate]=await race(()=>drop(a),()=>drop(b));
 assert.ifError(duplicate.error);assert.deepEqual(duplicate.value,dropped);
 assert.equal(await one(db,"select count(*)::int from trading.prospect_events where prospect_id=$1 and action='owner_drop'",[own.id]),1);
 const confirming=await command(db,uuid(),'add',{...args,name:'Owner drop after confirmation',fantrax_id:'race04'});
 const captured=JSON.stringify(owners.map(o=>({owner:o.slug,players:o.slug==='doug'?[{player_id:'race04',name:'Confirmed prospect'}]:[]})));
 const [,staleDrop]=await race(()=>a.query("select trading.ingest_rosters('NFL','race-nfl',clock_timestamp(),$1,false)",[captured]),()=>one(b,'select public.drop_own_prospect($1,$2,1,true)',[uuid(),confirming.id]));
 assert.match(staleDrop.error?.message??'',/changed/);
 console.log('PASS owner drop retries serialize once; roster confirmation rejects queued owner drop');
 const secondOwner=await one(db,"select id from draft.owners where slug='chris'");
 const draftId=await one(db,"insert into draft.drafts(name,kind,championship_year,rounds,participant_count) values('Prospect race','startup',2027,80,2) returning id");
 await db.query('insert into draft.draft_participants values($1,$2,1),($1,$3,2)',[draftId,owner,secondOwner]);
 await db.query('select draft.attach_startup_prospects($1)',[draftId]);
 await db.query('select draft.generate_snake_picks($1)',[draftId]);
 await db.query("update draft.drafts set status='paused' where id=$1",[draftId]);
 const pickSlots=(await db.query('select id,current_owner_id from draft.draft_picks where draft_id=$1 order by overall_pick_number limit 2',[draftId])).rows;
 const prospectId=await one(db,'select player_id from draft.prospect_catalog order by id limit 1');
 const insert=(c,slot)=>one(c,"insert into draft.draft_selections(draft_id,pick_id,owner_id,player_id,sport,method,actor_user_id) values($1,$2,$3,$4,'NFL','commissioner',$5) returning id",[draftId,slot.id,slot.current_owner_id,prospectId,user]);
 const [,conflict]=await race(()=>insert(a,pickSlots[0]),()=>insert(b,pickSlots[1]));
 assert.equal(conflict.error?.code,'23505');
 assert.equal(await one(db,'select count(*)::int from trading.prospects where draft_selection_id is not null'),1);
 console.log('PASS simultaneous prospect selections create only one selection and one cap slot');
 console.log('No hosted database contacted. Synthetic fixtures retained.');
}catch(e){console.error('FAIL prospect concurrency: '+e.message);process.exitCode=1;}
finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}}
