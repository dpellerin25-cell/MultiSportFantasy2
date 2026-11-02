import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {approveSource,enqueue,jobsDue,fetchTarget,saveCapture,markPending,hash} from './scheduled-scoring.mjs';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows,one=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
// All scores and mappings below are synthetic edge cases, not Fantrax captures.
const specFor=sport=>({version:1,sport,league_id:('fixture'+sport.toLowerCase()).padEnd(16,'x'),season_year:2026,is_test:true,start_date:'2026-10-29',end_date:sport==='PGA'?'2026-11-01':'2026-10-30',lineup_attribution_verified:true,reason:'Synthetic scheduling test only',teams:[{owner:'Doug',team_id:'doug'.padEnd(16,'x')},{owner:'Chris',team_id:'chris'.padEnd(16,'x')}],periods:sport==='PGA'?[{period:21,start_date:'2026-10-29'}]:[]});
function capture(j,{n=10,unknown=false,at='2026-11-01T12:00:00Z'}={}){
 const t=fetchTarget(j),d={...t,historical_test_data:true,production_ready:false,read_only:true,totals_reconcile:true,scoring_scope:j.sport==='PGA'?'tournament':'day',tournament_label:j.sport==='PGA'?'Synthetic Open (Thu Oct 29)':null,all_events_finished:true,active_total:n-3,bench_total:99};
 d.players=[['shared','ACTIVE',n],['negative','ACTIVE',-3],['bench','BENCH',99],...(unknown?[['missing','ACTIVE',null]]:[])].map(([id,lineup,value])=>({...t,player_id:id,player_name:id,lineup_group:lineup,fantasy_points:value,team_contribution:lineup==='BENCH'?0:value,stat_record_present:value!==null}));
 return {observed_at:at,diagnostic:d};
}
async function counts(owner,date,n,revision=0){return one('select scoring.record_roster_check($1,$2,$3)',[randomUUID(),{owner_id:owner,check_date:date,complete:true,reason:'Synthetic evidence',timing_policy:'scheduled-observation-v2',observed_at:`${date}T12:00:00Z`,sports:['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,count:i===0?n:0,observed_at:`${date}T12:00:00Z`,source_ref:'synthetic'}))},revision]);}
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec("insert into draft.roster_policy_versions values('synthetic-test-80','2026-10-28T00:00:00Z',80,80,10,'Synthetic policy boundary for offline fixtures')" );
 for(const sport of ['NFL','MLB','NBA','EPL','PGA']){
  const s=specFor(sport),preview=await approveSource(db,s);assert.equal(await one('select count(*)::int from scoring.sources where checksum=$1',[hash(s)]),0);
  await assert.rejects(()=>approveSource(db,s,{apply:true,approval:'wrong'}));
  await approveSource(db,s,{apply:true,approval:preview.approval_hash});assert.equal((await approveSource(db,s,{apply:true,approval:preview.approval_hash})).already_approved,true);
 }
 await assert.rejects(()=>approveSource(db,{...specFor('MLB'),lineup_attribution_verified:false}));
 await enqueue(db);const num=await one('select count(*)::int from scoring.jobs');await enqueue(db);assert.equal(await one('select count(*)::int from scoring.jobs'),num);
 const jobs=await jobsDue(db);assert.equal(jobs.length,16);assert.ok(jobs.every(j=>j.sport!=='PGA'));
 const j=jobs.find(j=>j.sport==='MLB'&&j.owner==='Doug'&&new Date(j.start_date).toISOString().startsWith('2026-10-29'));
 const first=await saveCapture(db,j,capture(j));assert.equal(first.status,'pending');const retry=await saveCapture(db,j,capture(j));assert.equal(retry.result_id,first.result_id);assert.ok(retry.unchanged);
 await counts(j.owner_id,'2026-10-30',80);assert.equal((await saveCapture(db,j,capture(j))).status,'eligible');
 await counts(j.owner_id,'2026-10-30',81,1);let outcome=await one('select scoring.evaluate($1,clock_timestamp())',[first.result_id]);assert.equal(outcome.adjusted_total,-3);assert.equal(outcome.removed_positive,10);
 await counts(j.owner_id,'2026-10-30',79,2);assert.equal((await saveCapture(db,j,capture(j))).status,'eligible');
 const corrected=await saveCapture(db,j,capture(j,{n:11,at:'2026-11-01T12:01:00Z'}));assert.notEqual(corrected.result_id,first.result_id);assert.equal(await one('select starter_total from scoring.results where id=$1',[first.result_id]),'7');
 assert.equal((await saveCapture(db,j,capture(j,{n:11,at:'2026-11-01T12:02:00Z'}))).unchanged,true);
 await assert.rejects(()=>saveCapture(db,j,capture(j)));assert.equal(await one('select count(*)::int from scoring.results where owner_id=$1',[j.owner_id]),2);
 const later=jobs.find(x=>x.sport==='MLB'&&x.owner==='Chris');await saveCapture(db,later,capture(later));assert.equal(await one("select count(distinct r.owner_id)::int from scoring.contributions c join scoring.results r on r.id=c.result_id where c.player_id='shared'"),2);
 const missing=jobs.find(x=>x.sport==='NBA'&&x.owner==='Doug');const m=await saveCapture(db,missing,capture(missing,{unknown:true}));assert.equal(m.status,'pending');
 const original=(await q('select * from scoring.results where id=$1',[m.result_id]))[0];
 const correctedBody={...original.payload,observed_at:'2026-11-01T12:04:00Z',reason:'Synthetic audited commissioner confirmation',correction_evidence:{original_result_id:m.result_id},players:original.payload.players.map(p=>p.state==='unknown'?{...p,state:'no_activity',evidence:'Synthetic confirmed non-participation'}:p)};delete correctedBody.scheduled_content_hash;
 const manual=await one('select scoring.import_result($1,$2,1)',[randomUUID(),correctedBody]);
 await q("update scoring.jobs set last_attempt='2020-01-01' where id=$1",[missing.id]);await jobsDue(db); // stale job pointer must not evaluate a superseded result
 assert.equal((await saveCapture(db,missing,capture(missing,{unknown:true,at:'2026-11-01T12:05:00Z'}))).result_id,manual);
 assert.equal(await one("select score_state from scoring.contributions where result_id=$1 and player_id='missing'",[manual]),'no_activity');
 await assert.rejects(()=>saveCapture(db,missing,capture(missing,{n:12,unknown:true,at:'2026-11-01T12:06:00Z'})),/Manual scoring revision/);
 await markPending(db,j.id,'INCOMPLETE_RESPONSE');assert.equal(await one('select last_error from scoring.jobs where id=$1',[j.id]),'INCOMPLETE_RESPONSE');await saveCapture(db,j,capture(j,{n:11,at:'2026-11-01T12:03:00Z'}));assert.equal(await one('select last_error from scoring.jobs where id=$1',[j.id]),null);
 await assert.rejects(()=>markPending(db,j.id,'secret response'));
 const pga=(await q(`select j.*,s.sport,s.league_id,s.season_year,s.is_test,src.specification,o.display_name owner from scoring.jobs j join scoring.sources src on src.id=j.source_id join scoring.seasons s on s.id=src.season_id join draft.owners o on o.id=j.owner_id where s.sport='PGA' and o.display_name='Doug'`))[0];
 const p=await saveCapture(db,pga,capture(pga));await counts(pga.owner_id,'2026-10-29',81);await counts(pga.owner_id,'2026-11-01',80);
 assert.equal((await one("select scoring.evaluate($1,'2026-11-03T13:00:00Z')",[p.result_id])).status,'eligible');
 await counts(pga.owner_id,'2026-11-01',81,1);assert.equal((await one("select scoring.evaluate($1,'2026-11-03T13:00:00Z')",[p.result_id])).adjusted_total,-3);
 // Test data never leaks, even if someone enables publish on its source.
 await db.exec('update scoring.sources set publish=true');await db.exec('set role anon');assert.equal((await one("select public.player_scoring_totals('MLB',2027,'Doug')")).available,false);await assert.rejects(()=>q('select * from scoring.results'),/permission denied/);await db.exec('reset role');
 // Synthetic future championship rows verify separate public scope; pending until due.
 for(const year of [2027,2028]){
  const sid=await one("insert into scoring.seasons(sport,league_id,season_year,championship_year,is_test) values('MLB',$1,$2,$2,false) returning id",['future'+year,year]);
  await q("insert into scoring.sources(season_id,specification,checksum,publish) values($1,'{}',$2,true)",[sid,'future'+year]);
  const pid=await one("insert into scoring.periods(season_id,scope,start_date,end_date,label) values($1,'day',$2,$2,'synthetic') returning id",[sid,`${year}-04-01`]);
  const rid=await one("insert into scoring.results(request_id,period_id,owner_id,revision,team_id,observed_at,starter_total,bench_total,events_finished,payload,reason) values($1,$2,$3,1,'synthetic',clock_timestamp(),$4,0,true,'{}','Synthetic future scope only') returning id",[randomUUID(),pid,j.owner_id,year]);
  await q("insert into scoring.contributions(result_id,player_id,player_name,lineup,raw_points,score_state) values($1,'future-player','Future player','ACTIVE',$2,'known')",[rid,year]);
 }
 await db.exec('set role anon');for(const year of [2027,2028]){const r=await one("select public.player_scoring_totals('MLB',$1,'Doug')",[year]);assert.equal(r.players.length,1);assert.equal(r.players[0].known_starter_points,year);assert.equal(r.players[0].counted_points,0);assert.equal(r.players[0].pending_periods,1);}await db.exec('reset role');
 console.log('PASS source preview/approval, all-sport queue, daily/PGA deadlines, retries, content corrections, stale capture rejection, trade attribution and unknown scores');
 console.log('PASS 79/80/81 cap evidence, positive-only daily/PGA penalties, public test isolation, overlapping championship scopes and denied raw reads');
}finally{await db.close();}


