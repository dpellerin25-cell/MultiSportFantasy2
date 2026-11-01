import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import assert from 'node:assert/strict';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows,one=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const doug=uuid(),chris=uuid(),outsider=uuid();for(const id of [doug,chris,outsider])await q('insert into auth.users values($1)',[id]);
 for(const [id,slug] of [[doug,'doug'],[chris,'chris']])await q('insert into draft.owner_accounts(owner_id,auth_user_id) select id,$1 from draft.owners where slug=$2',[id,slug]);
 await q("insert into draft.league_roles values($1,'commissioner')",[doug]);
 const owner=await one("select id from draft.owners where slug='doug'");
 const as=async(id,fn,role='authenticated')=>{await q("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);await db.exec('set role '+role);try{return await fn();}finally{await db.exec('reset role');}};
 const state=(test=false,page=0)=>one("select public.scoring_controls_state('2020-06-11',$1,0,$2)",[page,test]);
 for(const id of [chris,outsider]){
  await assert.rejects(()=>as(id,()=>state()),/Commissioner/);
  await assert.rejects(()=>as(id,()=>one("select public.scoring_controls_pause($1,true,'Not allowed',0,true)",[uuid()])),/Commissioner/);
  await assert.rejects(()=>as(id,()=>one('select public.scoring_controls_pga_review($1)',[uuid()])),/Commissioner/);
  await assert.rejects(()=>as(id,()=>one("select public.scoring_controls_pga_resolve($1,$2,'waive','Not allowed','[]',null,true)",[uuid(),uuid()])),/Commissioner/);
 }
 await assert.rejects(()=>as(null,()=>state(),'anon'),/permission denied/);
 let s=await as(doug,()=>state());assert.equal(s.pause.paused,false);assert.equal(s.checks.length,9);assert.ok(s.checks.every(c=>c.check_id===null));
 await assert.rejects(()=>as(doug,()=>state(false,-1)),/Invalid page/);
 await q('update draft.owners set active=false where id=$1',[owner]);await assert.rejects(()=>as(doug,()=>state()),/Commissioner/);await q('update draft.owners set active=true where id=$1',[owner]);
 const req=uuid(),pause=(confirmed=true,expected='0',id=req)=>as(doug,()=>one("select public.scoring_controls_pause($1,true,'Draft grace period',$2,$3)",[id,expected,confirmed]));
 await assert.rejects(()=>pause(false),/Confirm/);assert.equal(await one('select count(*)::int from scoring.pause_events'),0);
 const saved=await pause();assert.deepEqual(await pause(),saved);await assert.rejects(()=>pause(true,'0',uuid()),/Stale/);
 await as(doug,()=>one("select public.scoring_controls_pause($1,false,'Resume after grace period',$2,true)",[uuid(),saved.event_id]));
 s=await as(doug,()=>state());assert.equal(s.pause.paused,false);assert.equal(s.history.length,2);assert.equal(s.history[0].actor,'Doug');
 console.log('PASS commissioner-only bounded state, owner/outsider/anonymous/inactive denial, confirmed pause/resume, stale state and safe retries');

 const season=await one("insert into scoring.seasons(sport,league_id,season_year,is_test) values('PGA','controls-fixture',2020,true) returning id");
 const period=await one("insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) values($1,'tournament','2020-06-11','2020-06-14',21,'Synthetic Canadian Open') returning id",[season]);
 const result=await one('select scoring.import_result($1,$2,0)',[uuid(),{period_id:period,owner_id:owner,team_id:'fixture',observed_at:'2021-01-01Z',starter_total:7,bench_total:99,events_finished:true,reason:'Synthetic UI evidence',players:[{player_id:'a',player_name:'Positive',lineup:'ACTIVE',points:10,state:'known'},{player_id:'b',player_name:'Negative',lineup:'ACTIVE',points:-3,state:'known'},{player_id:'c',player_name:'Bench',lineup:'BENCH',points:99,state:'known'}]}]);
 await assert.rejects(()=>as(doug,()=>one('select public.scoring_controls_pga_review($1)',[result])),/does not require/);
 for(const day of ['2020-06-11','2020-06-14'])await one('select scoring.record_roster_check($1,$2,0)',[uuid(),{owner_id:owner,check_date:day,complete:true,reason:'Synthetic historical count',sports:['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,count:i?0:66,source_ref:uuid(),observed_at:day+'T08:05:00Z'}))}]);
 await q("insert into scoring.pause_events(request_id,paused,actor_id,reason,effective_at) values($1,true,$3,'Historical pause','2020-06-11T07:00Z'),($2,false,$3,'Historical resume','2020-06-14T07:00Z')",[uuid(),uuid(),doug]);
 const evidence=await as(doug,()=>one('select public.scoring_controls_pga_review($1)',[result]));assert.equal(evidence.enforce_total,-3);assert.equal(evidence.waive_total,7);assert.equal(evidence.overage_checks,2);
 assert.equal((await as(doug,()=>state())).pga.length,0);
 s=await as(doug,()=>state(true));assert.equal(s.pga.length,1);assert.equal(s.pga[0].is_test,true);assert.equal(s.checks.find(c=>c.owner==='Doug').total_players,66);
 const resolve=(choice='enforce',previous=null,id=uuid(),checks=evidence.checks)=>as(doug,()=>one("select public.scoring_controls_pga_resolve($1,$2,$3,'Reviewed historical evidence',$4,$5,true)",[id,result,choice,JSON.stringify(checks),previous]));
 const rid=uuid(),enforced=await resolve('enforce',null,rid);assert.deepEqual(await resolve('enforce',null,rid),enforced);
 await assert.rejects(()=>resolve('waive'),/Decision changed/);
 await assert.rejects(()=>resolve('waive',enforced.resolution_id,uuid(),[]),/evidence changed/);
 await resolve('waive',enforced.resolution_id);
 s=await as(doug,()=>state(true));assert.equal(s.pga[0].outcome.adjusted_total,7);assert.equal(s.history.filter(h=>h.kind==='pga').length,2);
 assert.equal((await as(doug,()=>state())).history.filter(h=>h.kind==='pga').length,0);
 await as(doug,async()=>{await assert.rejects(()=>q('select * from scoring.roster_checks'),/permission denied/);await assert.rejects(()=>q('delete from scoring.pause_events'),/permission denied/);});
 // History is paginated rather than silently discarding older decisions.
 await q("insert into scoring.pause_events(request_id,paused,actor_id,reason) select gen_random_uuid(),false,$1,'Synthetic pagination row' from generate_series(1,30)",[doug]);
 assert.equal((await as(doug,()=>state())).history.length,25);assert.equal((await as(doug,()=>state())).history_has_more,true);assert.ok((await as(doug,()=>state(false,1))).history.length>0);
 console.log('PASS PGA evidence preview, positive-only enforcement/waiver, stale confirmations, history pagination, test isolation and raw-table denial');
}finally{await db.close();}
