import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';

// Synthetic historical fixtures. Shared with offline rehearsal; only the real
// PostgreSQL runner proves that the second backend actually waits on a lock.
export async function scoringRaceScenarios({admin,race,report}) {
 const one=async(c,s,p=[])=>Object.values((await c.query(s,p)).rows[0])[0];
 const owner=await one(admin,"select id from draft.owners where slug='doug'");
 const actor=uuid();await admin.query('insert into auth.users values($1)',[actor]);
 await admin.query("insert into draft.league_roles values($1,'commissioner')",[actor]);
 const period=async(sport='MLB')=>{
   const season=await one(admin,"insert into scoring.seasons(sport,league_id,season_year) values($1,$2,2020) returning id",[sport,uuid()]);
   return one(admin,"insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) values($1,$2,'2020-06-11',$3,$4,'Synthetic concurrency fixture') returning id",[season,sport==='PGA'?'tournament':'day',sport==='PGA'?'2020-06-14':'2020-06-11',sport==='PGA'?21:null]);
 };
 const body=p=>({period_id:p,owner_id:owner,team_id:'synthetic-team',observed_at:'2021-01-01T00:00:00Z',starter_total:7,bench_total:99,events_finished:true,reason:'Synthetic race fixture',players:[{player_id:'a',player_name:'Positive',lineup:'ACTIVE',points:10,state:'known'},{player_id:'b',player_name:'Negative',lineup:'ACTIVE',points:-3,state:'known'},{player_id:'c',player_name:'Bench',lineup:'BENCH',points:99,state:'known'}]});
 const imp=(c,b,rev=0,req=uuid())=>one(c,'select scoring.import_result($1,$2,$3)',[req,b,rev]);
 const checkBody=(date,count)=>({owner_id:owner,check_date:date,complete:true,reason:'Synthetic count correction',sports:['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,count:i?0:count,source_ref:'synthetic-'+sport,observed_at:date+'T08:05:00Z'}))});
 const check=(c,date,count,rev=0)=>one(c,'select scoring.record_roster_check($1,$2,$3)',[uuid(),checkBody(date,count),rev]);
 const decision=(c,r,req=uuid())=>one(c,'select scoring.record_decision($1,$2)',[req,r]);
 const outcome=r=>one(admin,'select scoring.evaluate($1,clock_timestamp())',[r]);
 const rejects=(r,pattern)=>assert.match(r.second.error?.message??'',pattern);
 const asCommissioner=async(c)=>{await c.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);await c.query('set local role authenticated');};
 const pause=async(c,flag,expected)=>{await asCommissioner(c);return one(c,"select scoring.set_penalty_pause($1,$2,'Synthetic concurrency pause',$3)",[uuid(),flag,expected]);};

 const b=body(await period()), req=uuid();
 let r=await race(c=>imp(c,b,0,req),c=>imp(c,b,0,req));
 assert.ifError(r.second.error);assert.equal(r.first,r.second.value);
 assert.equal(Number(await one(admin,'select count(*) from scoring.results where period_id=$1',[b.period_id])),1);
 report('identical simultaneous import retries create one result');

 const conflict=body(await period()), key=uuid();
 r=await race(c=>imp(c,conflict,0,key),c=>imp(c,{...conflict,team_id:'different'},0,key));
 rejects(r,/Conflicting scoring retry/);
 report('changed payload with same request ID rejected');

 const changed={...b,observed_at:'2021-01-02T00:00:00Z'};
 r=await race(c=>imp(c,changed,1),c=>imp(c,changed,1));rejects(r,/Stale scoring revision/);
 const result=r.first;
 assert.equal(Number(await one(admin,'select count(*) from scoring.results where period_id=$1',[b.period_id])),2);
 report('simultaneous corrections preserve one next revision and original history');

 await check(admin,'2020-06-12',65);
 r=await race(c=>check(c,'2020-06-12',66,1),c=>decision(c,result));assert.ifError(r.second.error);
 assert.equal(await one(admin,'select status from scoring.decisions where id=$1',[r.second.value]),'penalized');
 assert.equal((await outcome(result)).adjusted_total,-3);
 report('count correction first: queued penalty uses corrected count and retains negatives');

 const decisionReq=uuid();
 r=await race(c=>decision(c,result,decisionReq),c=>check(c,'2020-06-12',65,2));assert.ifError(r.second.error);
 assert.equal(await one(admin,'select status from scoring.decisions where id=$1',[r.first]),'penalized');
 assert.equal((await outcome(result)).status,'eligible');
 assert.equal(await decision(admin,result,decisionReq),r.first);
 report('decision first: later count correction changes current outcome without rewriting audit');

 r=await race(c=>pause(c,true,0),c=>pause(c,false,0));rejects(r,/Stale pause state/);
 assert.equal(Number(await one(admin,'select count(*) from scoring.pause_events')),1);
 report('simultaneous pause changes reject stale commissioner state');

 // Privileged test fixtures establish a past mixed-pause tournament, never a
 // backdated browser command. Present-day pause events cannot alter this period.
 await admin.query("insert into scoring.pause_events(request_id,paused,effective_at,actor_id,reason) values($1,true,'2020-06-10Z',$3,'Synthetic historical pause'),($2,false,'2020-06-13Z',$3,'Synthetic historical resume')",[uuid(),uuid(),actor]);
 await check(admin,'2020-06-11',66);await check(admin,'2020-06-14',66);
 const pgBody=body(await period('PGA')), pg=await imp(admin,pgBody);
 assert.equal((await outcome(pg)).status,'pending');
 const evidence=(await outcome(pg)).checks;
 // node-postgres encodes JS arrays as PostgreSQL arrays, not JSON. Serialize
 // this JSONB argument explicitly so the real driver matches the offline run.
 const resolve=async(c,choice,checks=evidence,previous=null,request=uuid())=>{await asCommissioner(c);return one(c,"select scoring.resolve_pga_pause($1,$2,$3,'Synthetic commissioner decision',$4::jsonb,$5)",[request,pg,choice,JSON.stringify(checks),previous]);};
 r=await race(c=>resolve(c,'enforce'),c=>resolve(c,'waive'));rejects(r,/Decision changed/);
 const resolution=r.first;assert.equal((await outcome(pg)).adjusted_total,-3);
 report('conflicting PGA decisions serialize; only the first confirmation succeeds');

 r=await race(c=>check(c,'2020-06-14',65,1),c=>resolve(c,'waive',evidence,resolution));rejects(r,/evidence changed/);
 assert.equal((await outcome(pg)).status,'pending');
 report('count correction invalidates queued PGA confirmation and returns outcome to pending');

 const fresh=(await outcome(pg)).checks, retry=uuid();
 r=await race(c=>resolve(c,'waive',fresh,resolution,retry),c=>resolve(c,'waive',fresh,resolution,retry));
 assert.ifError(r.second.error);assert.equal(r.first,r.second.value);assert.equal((await outcome(pg)).adjusted_total,7);
 report('identical PGA decision retries return one audited resolution');

 const lastResolution=r.first;
 r=await race(c=>imp(c,{...pgBody,observed_at:'2021-01-02T00:00:00Z'},1),c=>resolve(c,'enforce',fresh,lastResolution));
 rejects(r,/superseded/);assert.equal((await outcome(r.first)).status,'pending');
 report('score correction rejects queued decision for superseded result');
}
