import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
export class ScoringSetupError extends Error {}

// Caller MUST start a transaction and roll it back. No account/role grants.
export async function validateHostedScoring(db,doug,other,report=console.log){
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const one=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
 const requireSetup=(ok,message)=>{if(!ok)throw new ScoringSetupError(message);};
 requireSetup(doug!==other,'Use two distinct test accounts.');
 requireSetup(await one("select to_regprocedure('scoring.resolve_pga_pause(uuid,uuid,text,text,jsonb,uuid)') is not null"),'Apply the scoring ledger migration to the TEST project first.');
 for(const [id,slug] of [[doug,'doug'],[other,'chris']])requireSetup(await one('select exists(select 1 from draft.owner_accounts a join draft.owners o on o.id=a.owner_id join auth.users u on u.id=a.auth_user_id where a.auth_user_id=$1 and o.slug=$2 and o.active)',[id,slug]),`Test account must be linked to active ${slug}.`);
 requireSetup(await one("select exists(select 1 from draft.league_roles where auth_user_id=$1 and role='commissioner')",[doug]),'Doug must already be commissioner.');
 requireSetup(!await one("select exists(select 1 from draft.league_roles where auth_user_id=$1 and role='commissioner')",[other]),'Chris must not be commissioner.');
 await q('select pg_advisory_xact_lock(731944,1)');
 const owner=await one("select id from draft.owners where slug='doug'");
 requireSetup(!await one("select exists(select 1 from scoring.roster_checks where owner_id=$1 and check_date in ('2020-06-11','2020-06-14'))",[owner]),'Reserved synthetic June 2020 check dates already contain data. Do not delete it to run this test.');
 async function asRole(who,role,fn){
   await q('savepoint scoring_role');
   try{
     await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[who??'',JSON.stringify({sub:who,role})]);
     await q(role==='anon'?'set local role anon':'set local role authenticated');
     assert.equal(await one('select auth.uid()'),who);
     const v=await fn();await q('reset role');await q('release savepoint scoring_role');return v;
   }catch(e){await q('rollback to savepoint scoring_role');await q('release savepoint scoring_role');throw e;}
 }
 const season=await one("insert into scoring.seasons(sport,league_id,season_year,is_test) values('PGA',$1,2020,true) returning id",['hosted-scoring-fixture-'+uuid()]);
 const period=await one("insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) values($1,'tournament','2020-06-11','2020-06-14',21,'ROLLBACK ONLY scoring fixture') returning id",[season]);
 const body={period_id:period,owner_id:owner,team_id:'synthetic-only',observed_at:'2021-01-01T00:00:00Z',starter_total:7,bench_total:99,events_finished:true,reason:'ROLLBACK ONLY scoring fixture',players:[{player_id:'pos',player_name:'Synthetic positive',lineup:'ACTIVE',points:10,state:'known'},{player_id:'neg',player_name:'Synthetic negative',lineup:'ACTIVE',points:-3,state:'known'},{player_id:'bench',player_name:'Synthetic bench',lineup:'BENCH',points:99,state:'known'}]};
 const importReq=uuid();const result=await one('select scoring.import_result($1,$2,0)',[importReq,JSON.stringify(body)]);
 assert.equal(await one('select scoring.import_result($1,$2,0)',[importReq,JSON.stringify(body)]),result);
 for(const date of ['2020-06-11','2020-06-14'])await one('select scoring.record_roster_check($1,$2,0)',[uuid(),JSON.stringify({owner_id:owner,check_date:date,complete:true,reason:'ROLLBACK ONLY count',sports:['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,count:i?0:66,source_ref:'synthetic-only',observed_at:date+'T08:05:00Z'}))})]);
 await q("insert into scoring.pause_events(request_id,paused,effective_at,actor_id,reason) values($1,true,'2020-06-11T07:59:58Z',$3,'ROLLBACK ONLY historical pause'),($2,false,'2020-06-14T07:59:58Z',$3,'ROLLBACK ONLY historical resume')",[uuid(),uuid(),doug]);
 const review=()=>one('select scoring.review_pga_resolution($1)',[result]);
 const preview=await asRole(doug,'authenticated',review);assert.equal(preview.status,'pending');
 const resolve=(choice,previous=null,req=uuid(),checks=preview.checks)=>one("select scoring.resolve_pga_pause($1,$2,$3,'ROLLBACK ONLY commissioner ruling',$4::jsonb,$5)",[req,result,choice,JSON.stringify(checks),previous]);
 for(const who of [other,uuid()]){
   await assert.rejects(()=>asRole(who,'authenticated',review),/Commissioner/);
   await assert.rejects(()=>asRole(who,'authenticated',()=>resolve('waive')),/Commissioner/);
   await assert.rejects(()=>asRole(who,'authenticated',()=>one("select scoring.set_penalty_pause($1,true,'Denied test pause',0)",[uuid()])),/Commissioner/);
 }
 report('PASS hosted SQL roles: real linked identities; owner/outsider cannot review, resolve or pause');
 const req=uuid();const enforced=await asRole(doug,'authenticated',()=>resolve('enforce',null,req));
 assert.equal(await asRole(doug,'authenticated',()=>resolve('enforce',null,req)),enforced);
 let outcome=await asRole(doug,'authenticated',review);assert.equal(outcome.adjusted_total,-3);assert.equal(outcome.removed_positive,10);
 await assert.rejects(()=>asRole(doug,'authenticated',()=>resolve('waive')),/Decision changed/);
 await assert.rejects(()=>asRole(doug,'authenticated',()=>resolve('waive',null,req)),/Conflicting/);
 await asRole(doug,'authenticated',()=>resolve('waive',enforced));
 assert.equal((await asRole(doug,'authenticated',review)).adjusted_total,7);
 const latest=await one('select coalesce(max(id),0) from scoring.pause_events');const pauseReq=uuid();
 const pause=expected=>one("select scoring.set_penalty_pause($1,true,'ROLLBACK ONLY pause',$2)",[pauseReq,expected]);
 const event=await asRole(doug,'authenticated',()=>pause(latest));assert.equal(await asRole(doug,'authenticated',()=>pause(latest)),event);
 await asRole(doug,'authenticated',()=>one("select scoring.set_penalty_pause($1,false,'ROLLBACK ONLY resume',$2)",[uuid(),event]));
 report('PASS hosted commissioner enforce/waive, negative preservation, pause/resume, retries and stale confirmation denial');
 for(const who of [doug,other]){
   await assert.rejects(()=>asRole(who,'authenticated',()=>q('select * from scoring.results')),/permission denied/);
   await assert.rejects(()=>asRole(who,'authenticated',()=>q('delete from scoring.pause_events')),/permission denied/);
   await assert.rejects(()=>asRole(who,'authenticated',()=>one('select scoring.import_result($1,$2,0)',[uuid(),JSON.stringify(body)])),/permission denied/);
   await assert.rejects(()=>asRole(who,'authenticated',()=>one('select scoring.evaluate($1,clock_timestamp())',[result])),/permission denied/);
 }
 await assert.rejects(()=>asRole(null,'anon',review),/permission denied/);
 await assert.rejects(()=>asRole(null,'anon',()=>resolve('waive')),/permission denied/);
 report('PASS raw table/helper/write denial for owners and commissioner; anonymous commands denied');
 return {season,result};
}
