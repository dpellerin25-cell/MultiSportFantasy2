import pg from 'pg';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {syncConnection} from './trade-roster-sync.mjs';
import {enqueue,jobsDue,fetchTarget,saveCapture,markPending} from './scheduled-scoring.mjs';
const fetchFile=fileURLToPath(new URL('../../scripts/fetch_scheduled_scoring.py',import.meta.url));
function capture(target){return new Promise((resolve,reject)=>{
 const child=spawn(process.env.PYTHON||'python',[fetchFile],{env:process.env,stdio:['pipe','pipe','pipe'],windowsHide:true});
 let output='',bytes=0,settled=false;const timer=setTimeout(()=>{child.kill();reject(Error('FETCH_FAILED'));},60000);
 child.stdout.on('data',b=>{bytes+=b.length;if(bytes>8*1024*1024){child.kill();return;}output+=b;});child.stderr.resume();
 child.on('error',()=>{clearTimeout(timer);settled=true;reject(Error('FETCH_FAILED'));});
 child.on('close',code=>{clearTimeout(timer);if(settled)return;if(code!==0||bytes>8*1024*1024)return reject(Error('INCOMPLETE_RESPONSE'));try{resolve(JSON.parse(output));}catch{reject(Error('INCOMPLETE_RESPONSE'));}});
 child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(target));
});}
let db;
try{
 const [mode,jobId]=process.argv.slice(2);assert.ok(['--preview','--run','--status'].includes(mode)&&process.argv.length<=4);
 assert.equal(process.env.SCORING_PROJECT_CONFIRM,process.env.TRADE_ROSTER_PROJECT_REF);assert.ok(process.env.SCORING_PROJECT_CONFIRM);
 if(jobId)assert.match(jobId,/^[0-9a-f-]{36}$/i);
 db=new pg.Client(syncConnection(process.env));await db.connect();
 await db.query("set statement_timeout='60s'; set lock_timeout='15s'");
 // Session lock serializes network jobs as well as writes. A process crash releases it.
 assert.equal((await db.query('select pg_try_advisory_lock(731944,2) locked')).rows[0].locked,true,'Another collector is active');
 if(mode==='--status'){
  const rows=(await db.query(`select s.sport,s.season_year,s.is_test,src.enabled,src.publish,
   count(j.id)::int jobs,count(j.id) filter(where j.due_at<=clock_timestamp() and j.result_id is null)::int awaiting_capture,
   count(j.id) filter(where j.last_error is not null)::int fetch_or_import_errors,
   count(j.id) filter(where case when latest.id is not null then scoring.evaluate(latest.id,clock_timestamp())->>'status'='pending' else false end)::int eligibility_or_scoring_pending,
   max(j.last_attempt) last_attempt from scoring.sources src join scoring.seasons s on s.id=src.season_id left join scoring.jobs j on j.source_id=src.id
   left join scoring.periods period on period.season_id=s.id and period.start_date=j.start_date
   left join scoring.latest_results latest on latest.period_id=period.id and latest.owner_id=j.owner_id
   group by src.id,s.sport,s.season_year,s.is_test order by s.season_year,s.sport`)).rows;
  console.log(JSON.stringify(rows,null,2));
 }else{
 await db.query('begin');await enqueue(db);
 const jobs=await jobsDue(db,{limit:Number(process.env.SCORING_BATCH_LIMIT||200),jobId:jobId||null});
 await db.query(mode==='--preview'?'rollback':'commit');
 if(mode==='--preview')console.log(JSON.stringify({preview:true,jobs:jobs.map(j=>({sport:j.sport,owner:j.owner,date:j.start_date,period:j.source_period,is_test:j.is_test,job_id:j.id}))},null,2));
 else{
  assert.ok(process.env.FANTRAX_COOKIE,'FANTRAX_COOKIE required');let failed=0;
  for(const job of jobs){
   try{const data=await capture(fetchTarget(job));console.log(JSON.stringify(await saveCapture(db,job,data)));}
   catch(e){const code=['FETCH_FAILED','INCOMPLETE_RESPONSE'].includes(e.message)?e.message:'IMPORT_REVIEW_REQUIRED';await markPending(db,job.id,code);console.error(`${job.sport} ${job.start_date}: ${code}; job ${job.id}`);failed++;}
  }
  console.log(JSON.stringify({attempted:jobs.length,failed,standings_changed:false}));if(failed)process.exitCode=1;
 }
 }
}catch{console.error('Scheduled scoring failed. Check explicit project settings, source approvals, migration and verified TLS. No standings changed. Retry safely; earlier jobs may have committed.');process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}

