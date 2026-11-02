// Real independent-session tests, only on an empty disposable local PostgreSQL DB.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {scoringTestConfig} from './scoring-test-config.mjs';
import {approveSource,enqueue,jobsDue,fetchTarget,saveCapture} from './scheduled-scoring.mjs';
const cs=Array.from({length:3},()=>new pg.Client(scoringTestConfig(process.env.LOCAL_SCORING_TEST_DB_URL))),[admin,a,b]=cs;
const one=async(c,s,p=[])=>Object.values((await c.query(s,p)).rows[0])[0];
try{
 for(const c of cs){await c.connect();await c.query("set statement_timeout='15s';set idle_in_transaction_session_timeout='30s'");}
 assert.equal(await one(admin,"select count(*)::int from pg_tables where schemaname not in ('pg_catalog','information_schema')"),0,'Use an empty disposable database');
 await admin.query("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL(f,dir),'utf8'));
 const spec={version:1,sport:'MLB',league_id:'syntheticmlb0001',season_year:2020,is_test:true,start_date:'2020-06-11',end_date:'2020-06-11',lineup_attribution_verified:true,reason:'Synthetic independent-session fixture',teams:[{owner:'Doug',team_id:'syntheticteam001'}],periods:[]};
 const preview=await approveSource(admin,spec);await approveSource(admin,spec,{apply:true,approval:preview.approval_hash});await enqueue(admin);const job=(await jobsDue(admin))[0];
 const capture=(points=10,observed_at='2021-01-01T12:00:00Z')=>{const t=fetchTarget(job);return {observed_at,diagnostic:{...t,historical_test_data:true,production_ready:false,read_only:true,totals_reconcile:true,scoring_scope:'day',tournament_label:null,all_events_finished:true,active_total:points,bench_total:0,players:[{...t,player_id:'p',player_name:'Synthetic player',lineup_group:'ACTIVE',fantasy_points:points,team_contribution:points,stat_record_present:true}]}};};
 const pidA=await one(a,'select pg_backend_pid()'),pidB=await one(b,'select pg_backend_pid()');
 async function race(first,second){
  let release,acquired;const hold=new Promise(r=>release=r),locked=new Promise(r=>acquired=r);
  const adapter={query:async(s,p)=>{const out=await a.query(s,p);if(s==='select pg_advisory_xact_lock(731944,1)'){acquired();await hold;}return out;}};
  const pa=saveCapture(adapter,job,first).then(value=>({value}),error=>({error}));await locked;
  const pb=saveCapture(b,job,second).then(value=>({value}),error=>({error}));
  try{let blocked=false;for(let i=0;i<100;i++){if(await one(admin,'select $1=any(pg_blocking_pids($2))',[pidA,pidB])){blocked=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(blocked,'Must observe a real lock wait');}
  finally{release();}
  return Promise.all([pa,pb]);
 }
 let [x,y]=await race(capture(),capture());assert.ifError(x.error);assert.ifError(y.error);assert.equal(x.value.result_id,y.value.result_id);assert.equal(await one(admin,'select count(*)::int from scoring.results'),1);
 console.log('PASS independent sessions: simultaneous identical captures produce one result and one decision');
 assert.equal(await one(admin,'select count(*)::int from scoring.decisions'),1);
 [x,y]=await race(capture(11,'2021-01-02T12:00:00Z'),capture(12,'2021-01-01T13:00:00Z'));assert.ifError(x.error);assert.match(y.error?.message??'',/Stale capture/);assert.equal(await one(admin,'select count(*)::int from scoring.results'),2);
 console.log('PASS independent sessions: newer correction wins; queued older capture cannot overwrite it');
 assert.equal(await one(admin,'select starter_total from scoring.results where revision=1'),'10');
 console.log('No hosted database contacted. Synthetic fixtures retained.');
}catch(e){console.error('FAIL scheduled scoring concurrency: '+e.message);process.exitCode=1;}
finally{for(const c of cs){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}}
