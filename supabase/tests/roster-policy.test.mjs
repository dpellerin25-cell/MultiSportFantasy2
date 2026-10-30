import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import assert from 'node:assert/strict';
import {POLICY,STARTUP_ROUNDS} from './roster-policy.mjs';
import {snakePreview} from './draft-setup.mjs';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
const one=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url),files=(await readdir(dir)).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'202610290001'))await db.exec(await readFile(new URL(f,dir),'utf8'));
 const owner=await one("select id from draft.owners where slug='doug'"),user=uuid();
 await q('insert into auth.users values($1)',[user]);
 const old=await one("insert into draft.drafts(name,kind,championship_year,rounds) values('Historical setup','startup',2027,65) returning id");
 const retired=await one("insert into draft.drafts(name,kind,championship_year,rounds,status) values('Retired history','startup',2027,65,'paused') returning id");
 await q("select draft.retire_rehearsal($1,0,'Synthetic retired rehearsal; preserve all history')",[retired]);
 const slotted=await one("insert into draft.drafts(name,kind,championship_year,rounds) values('Existing slots','startup',2027,65) returning id");
 await q('insert into draft.draft_participants select $1,id,row_number() over(order by slug) from draft.owners',[slotted]);
 await q('select draft.generate_snake_picks($1)',[slotted]);
 const retiredBefore=await one('select to_jsonb(d) from draft.drafts d where id=$1',[retired]);
 const alerts=[];
 for(const count of [66,79,80,81,82]){
  // Separate owners satisfy the one-open-alert invariant.
  const o=await one('select id from draft.owners order by slug offset $1 limit 1',[alerts.length]);
  const a=await one('insert into trading.roster_limit_alerts(owner_id,player_count) values($1,$2) returning id',[o,count]);alerts.push(a);
  await q("insert into trading.notifications(roster_alert_id,recipient_user_id,kind) values($1,$2,'roster_limit')",[a,user]);
 }
 await q("update trading.notifications set status='sent',sent_at=clock_timestamp(),provider_id='preserved-receipt',delivery_payload=$2 where roster_alert_id=$1",[alerts[0],{subject:'Historical 65-player warning'}]);
 await q("update trading.notifications set status='sending',first_attempt_at=clock_timestamp(),delivery_payload=$2 where roster_alert_id=$1",[alerts[4],{subject:'Uncertain historical delivery'}]);
 // Synthetic activation date ONLY in this disposable test, to exercise both rules.
 for(const f of files.filter(f=>f>='202610290001')){
  const source=await readFile(new URL(f,dir),'utf8');
  await db.exec(source.replace("'2026-10-29-80',clock_timestamp()","'2026-10-29-80','2020-06-12T08:00:00Z'"));
 }
 const policy=(await q('select * from draft.roster_policy_versions where version=$1',[POLICY.version]))[0];
 assert.equal(policy.roster_limit,POLICY.roster_limit);assert.equal(policy.startup_rounds,STARTUP_ROUNDS);assert.equal(policy.annual_rounds,10);
 assert.equal(await one("select draft.roster_cap_at('2020-06-12T07:59:59Z')"),65);
 assert.equal(await one("select draft.roster_cap_at('2020-06-12T08:00:00Z')"),80);
 assert.equal(await one('select rounds from draft.drafts where id=$1',[old]),65);
 assert.deepEqual(await one('select to_jsonb(d) from draft.drafts d where id=$1',[retired]),retiredBefore);
 assert.equal(await one('select count(*)::int from draft.draft_picks where draft_id=$1',[slotted]),585);
 for(const id of [slotted,retired]){
  const blocked=await one('select draft.preview_startup_transition($1)',[id]);assert.ok(blocked.blockers.length);
  await assert.rejects(()=>q('select draft.apply_startup_transition($1,$2)',[id,blocked.approval_hash]),/blocked/);
 }
 assert.equal(await one('select count(*)::int from trading.roster_limit_alerts where resolved_at is not null'),3);
 assert.equal(await one("select count(*)::int from trading.notifications where next_attempt_at='infinity'"),3);
 const sent=(await q("select status,provider_id,delivery_payload from trading.notifications where roster_alert_id=$1",[alerts[0]]))[0];
 assert.deepEqual(sent,{status:'sent',provider_id:'preserved-receipt',delivery_payload:{subject:'Historical 65-player warning'}});
 assert.equal(await one('select count(*)::int from trading.roster_policy_cleanup'),5);
 assert.equal(await one('select status from trading.notifications where roster_alert_id=$1',[alerts[3]]),'pending');
 assert.deepEqual(await one('select delivery_payload from trading.notifications where roster_alert_id=$1',[alerts[4]]),{subject:'Uncertain historical delivery'});
 await assert.rejects(()=>q("insert into draft.drafts(name,kind,championship_year,rounds) values('Invalid','startup',2027,65)"),/80 rounds/);
 await assert.rejects(()=>q("update draft.drafts set status='running' where id=$1",[old]),/transition/);
 for(const n of [8,11,12]){
  const preview=snakePreview(Array.from({length:n},(_,i)=>String(i)));assert.equal(preview.length,80*n);
  assert.equal(preview.at(-1).owner,'0');assert.equal(preview[n-1].owner,preview[n].owner);
 }
 const imp=await one("insert into draft.player_pool_imports(checksum,schema_version) values(repeat('a',64),1) returning id");
 await q('update draft.drafts set import_id=$2 where id=$1',[old,imp]);
 await q("insert into draft.players(sport,name) select 'NFL','Policy test '||n from generate_series(1,720) n");
 await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fixture','policy',id::text from draft.players");
 await q("insert into draft.player_pool_entries select $1,p.id,s.id,p.sport,p.name,null,null,'free_agent' from draft.players p join draft.player_source_ids s on s.player_id=p.id",[imp]);
 await q("insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,availability,eligible) select $1,$2,id,sport,name,'free_agent',true from draft.players",[old,imp]);
 let plan=await one('select draft.preview_startup_transition($1)',[old]);assert.deepEqual(plan.blockers,[]);
 await q('update draft.drafts set revision=revision+1 where id=$1',[old]);
 await assert.rejects(()=>q('select draft.apply_startup_transition($1,$2)',[old,plan.approval_hash]),/preview again/);
 plan=await one('select draft.preview_startup_transition($1)',[old]);
 const applied=await one('select draft.apply_startup_transition($1,$2)',[old,plan.approval_hash]);assert.equal(applied.already_applied,false);
 assert.equal((await one('select draft.apply_startup_transition($1,$2)',[old,plan.approval_hash])).already_applied,true);
 assert.equal(await one('select count(*)::int from draft.startup_transitions'),1);
 assert.equal(await one('select count(*)::int from draft.draft_picks where draft_id=$1',[old]),0);
 console.log('PASS policy parity/effective boundary, historical draft preservation, 80-round configurable snake, explicit transition/retry, obsolete notification cleanup');
 const check=async(day,count,rev=0)=>one('select scoring.record_roster_check($1,$2,$3)',[uuid(),{owner_id:owner,check_date:day,complete:true,reason:'Synthetic policy boundary',sports:['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,count:i?0:count,source_ref:uuid(),observed_at:day+'T08:05:00Z'}))},rev]);
 const result=async(sport,start,end)=>{
  const season=await one('insert into scoring.seasons(sport,league_id,season_year,is_test) values($1,$2,2020,true) returning id',[sport,uuid()]);
  const p=await one("insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) values($1,$2,$3,$4,$5,'Synthetic cap test') returning id",[season,sport==='PGA'?'tournament':'day',start,end,sport==='PGA'?21:null]);
  return one('select scoring.import_result($1,$2,0)',[uuid(),{period_id:p,owner_id:owner,team_id:'fixture',observed_at:'2021-01-01Z',starter_total:7,bench_total:99,events_finished:true,reason:'Synthetic policy test',players:[{player_id:'a',player_name:'A',lineup:'ACTIVE',points:10,state:'known'},{player_id:'b',player_name:'B',lineup:'ACTIVE',points:-3,state:'known'},{player_id:'c',player_name:'C',lineup:'BENCH',points:99,state:'known'}]}]);
 };
 const evaluate=r=>one("select scoring.evaluate($1,'2090-01-01')",[r]);
 const dailies=[];for(const sport of ['NFL','MLB','NBA','EPL'])dailies.push(await result(sport,'2020-06-11','2020-06-11'));
 const daily=dailies[0];
 assert.equal((await evaluate(daily)).status,'pending');
 for(const [i,count] of [79,80,81].entries()){
  await check('2020-06-12',count,i);
  for(const r of dailies){const o=await evaluate(r);assert.equal(o.status,count>80?'penalized':'eligible');assert.equal(o.adjusted_total,count>80?-3:7);}
 }
 const decision=await one('select scoring.record_decision($1,$2)',[uuid(),daily]);
 await check('2020-06-12',80,3);assert.equal((await evaluate(daily)).status,'eligible');
 assert.equal(await one('select status from scoring.decisions where id=$1',[decision]),'penalized');
 const pga=await result('PGA','2020-06-11','2020-06-14');
 await check('2020-06-11',79);await check('2020-06-14',80);
 assert.equal((await evaluate(pga)).status,'eligible'); // Thursday old65, Sunday new80
 await check('2020-06-14',81,1);assert.equal((await evaluate(pga)).adjusted_total,-3);
 assert.equal(await one("select total_players from scoring.roster_checks where check_date='2020-06-12' and revision=1"),79);
 console.log('PASS daily 79/80/81, negative retention, PGA mixed effective-date checks, pending evidence and immutable correction/decision history');
 await db.exec('set role authenticated');await assert.rejects(()=>q('select * from draft.roster_policy_versions'));await assert.rejects(()=>q('select draft.apply_startup_transition($1,$2)',[old,plan.approval_hash]));await db.exec('reset role');
}finally{await db.close();}
