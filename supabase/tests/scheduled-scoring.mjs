import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateScoringImport} from './scoring-import.mjs';
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const iso=x=>x instanceof Date?x.toISOString().slice(0,10):x;
const validDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const one=async(db,s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
export async function approveSource(db,spec,{apply=false,approval,registry}={}){
 assert.equal(spec.version,1);assert.ok(['NFL','MLB','NBA','EPL','PGA'].includes(spec.sport));
 assert.equal(typeof spec.is_test,'boolean');assert.equal(spec.lineup_attribution_verified,true,'Verify historical counted lineup attribution in Fantrax first');
 assert.ok(typeof spec.reason==='string'&&spec.reason.trim().length>=5);
 assert.ok(Number.isInteger(spec.season_year)&&spec.season_year>=2000&&spec.season_year<=2200);
 assert.ok(spec.is_test||spec.season_year>=2027,'Pre-launch seasons cannot be championship results');
 assert.ok(/^[a-z0-9]{16}$/.test(spec.league_id));
 if(!spec.is_test){const current=registry?.sports?.[spec.sport];assert.equal(current?.current_league_id,spec.league_id,'League must match approved runtime connection');assert.equal(current?.current_season_year,spec.season_year);}
 assert.ok(validDate(spec.start_date)&&validDate(spec.end_date)&&spec.start_date<=spec.end_date);
 assert.equal(Number(spec.start_date.slice(0,4)),spec.season_year);
 assert.ok(Number(spec.end_date.slice(0,4))<=spec.season_year+(['NFL','NBA','EPL'].includes(spec.sport)?1:0));
 assert.ok(Array.isArray(spec.teams)&&spec.teams.length>0);
 assert.equal(new Set(spec.teams.map(t=>t.team_id)).size,spec.teams.length);
 assert.equal(new Set(spec.teams.map(t=>t.owner)).size,spec.teams.length);
 assert.ok(spec.teams.every(t=>/^[a-z0-9]{16}$/.test(t.team_id)&&typeof t.owner==='string'));
 assert.ok(Array.isArray(spec.periods));
 if(spec.sport==='PGA'){
  assert.ok(spec.periods.length>0,'Provide verified PGA period IDs and Thursday start dates');
  assert.equal(new Set(spec.periods.map(p=>p.period)).size,spec.periods.length);
  assert.equal(new Set(spec.periods.map(p=>p.start_date)).size,spec.periods.length);
  for(const p of spec.periods){assert.ok(Number.isInteger(p.period)&&p.period>0&&validDate(p.start_date)&&new Date(p.start_date).getUTCDay()===4);assert.ok(p.start_date>=spec.start_date&&new Date(Date.parse(p.start_date)+3*86400000).toISOString().slice(0,10)<=spec.end_date);}
 }else assert.equal(spec.periods.length,0);
 const checksum=hash(spec);assert.ok(!apply||approval===checksum,'Approval must match preview');
 await db.query('begin');try{
  await db.query('select pg_advisory_xact_lock(731943,1)');await db.query('select pg_advisory_xact_lock(731944,1)');
  const owners=(await db.query('select id,display_name from draft.owners where active order by display_name')).rows;
  if(!spec.is_test)assert.deepEqual(spec.teams.map(t=>t.owner).sort(),owners.map(o=>o.display_name).sort(),'All active owners required');
  assert.ok(spec.teams.every(t=>owners.some(o=>o.display_name===t.owner)));
  const prior=(await db.query('select src.* from scoring.sources src join scoring.seasons s on s.id=src.season_id where s.sport=$1 and s.league_id=$2',[spec.sport,spec.league_id])).rows[0];
  if(prior){assert.equal(prior.checksum,checksum,'Existing source approval differs; do not replace historical mappings');await db.query('rollback');return {approval_hash:checksum,already_approved:true,source_id:prior.id};}
  let season=(await db.query('select * from scoring.seasons where sport=$1 and league_id=$2',[spec.sport,spec.league_id])).rows[0];
  if(season){assert.equal(season.is_test,spec.is_test);assert.equal(season.season_year,spec.season_year);}
  else season=(await db.query('insert into scoring.seasons(sport,league_id,season_year,championship_year,is_test) values($1,$2,$3,$4,$5) returning *',[spec.sport,spec.league_id,spec.season_year,spec.is_test?null:spec.season_year,spec.is_test])).rows[0];
  const stored={...spec,teams:spec.teams.map(t=>({...t,owner_id:owners.find(o=>o.display_name===t.owner).id}))};
  const id=await one(db,'insert into scoring.sources(season_id,specification,checksum) values($1,$2,$3) returning id',[season.id,JSON.stringify(stored),checksum]);
  await db.query(apply?'commit':'rollback');return {approval_hash:checksum,applied:apply,source_id:apply?id:null,is_test:spec.is_test,owners:spec.teams.length,publishing:false};
 }catch(e){await db.query('rollback');throw e;}
}

export async function enqueue(db){
 // Every configured date is persisted; collection failures cannot silently omit a day.
 await db.query(`insert into scoring.jobs(source_id,owner_id,team_id,start_date,end_date,source_period,due_at)
 select src.id,o.id,t->>'team_id',d.day::date,d.day::date,null,(d.day::date+1+time '04:00') at time zone 'America/New_York'
 from scoring.sources src join scoring.seasons s on s.id=src.season_id
 cross join lateral jsonb_array_elements(src.specification->'teams') t join draft.owners o on o.id=(t->>'owner_id')::uuid
 cross join lateral generate_series((src.specification->>'start_date')::date,least((src.specification->>'end_date')::date,(clock_timestamp() at time zone 'America/New_York')::date-1),interval '1 day') d(day)
 where src.enabled and s.sport<>'PGA' on conflict do nothing`);
 await db.query(`insert into scoring.jobs(source_id,owner_id,team_id,start_date,end_date,source_period,due_at)
 select src.id,o.id,t->>'team_id',(p->>'start_date')::date,(p->>'start_date')::date+3,(p->>'period')::int,((p->>'start_date')::date+5+time '08:00') at time zone 'America/New_York'
 from scoring.sources src join scoring.seasons s on s.id=src.season_id
 cross join lateral jsonb_array_elements(src.specification->'teams') t join draft.owners o on o.id=(t->>'owner_id')::uuid
 cross join lateral jsonb_array_elements(src.specification->'periods') p
 where src.enabled and s.sport='PGA' on conflict do nothing`);
}
export async function jobsDue(db,{limit=200,jobId=null}={}){
 assert.ok(Number.isInteger(limit)&&limit>=1&&limit<=1000);
 return (await db.query(`select j.*,s.sport,s.league_id,s.season_year,s.is_test,src.specification,
 (select t->>'owner' from jsonb_array_elements(src.specification->'teams') t where t->>'team_id'=j.team_id) owner
 from scoring.jobs j join scoring.sources src on src.id=j.source_id join scoring.seasons s on s.id=src.season_id join draft.owners o on o.id=j.owner_id
 left join scoring.periods period on period.season_id=s.id and period.start_date=j.start_date
 left join scoring.latest_results latest on latest.period_id=period.id and latest.owner_id=j.owner_id
 where src.enabled and j.due_at<=clock_timestamp() and ($2::uuid is null or j.id=$2) and
 ($2::uuid is not null or j.last_attempt is null or (j.last_attempt<clock_timestamp()-interval '6 hours' and
 (j.last_error is not null or j.end_date>=(clock_timestamp() at time zone 'America/New_York')::date-14 or latest.id is null or case when latest.id is not null then scoring.evaluate(latest.id,clock_timestamp())->>'status'='pending' else false end)))
 order by j.last_attempt nulls first,j.due_at,j.id limit $1`,[limit,jobId])).rows;
}
export function fetchTarget(job){return {sport:job.sport,league_id:job.league_id,team_id:job.team_id,owner:job.owner,scoring_date:job.sport==='PGA'?null:iso(job.start_date),tournament_period:job.source_period};}
export async function saveCapture(db,job,capture){
 // Validation reuses the strict captured diagnostic contract, not an invented API.
 const d=capture.diagnostic;assert.deepEqual(Object.fromEntries(Object.keys(fetchTarget(job)).map(k=>[k,d[k]])),fetchTarget(job));
 const v=validateScoringImport({version:1,is_test:true,season_year:job.season_year,expected_revision:0,reason:'Scheduled Fantrax scoring capture',observed_at:capture.observed_at,tournament_start:job.sport==='PGA'?iso(job.start_date):undefined,diagnostic:d});
 const semantic={players:v.players.sort((a,b)=>a.player_id.localeCompare(b.player_id)),starter_total:d.active_total,bench_total:d.bench_total,events_finished:d.all_events_finished===true};
 const contentHash=hash(semantic);
 await db.query('begin');try{
  await db.query('select pg_advisory_xact_lock(731944,1)');
  const live=(await db.query('select * from scoring.jobs where id=$1 for update',[job.id])).rows[0];assert.ok(live);assert.ok(await one(db,'select enabled from scoring.sources where id=$1',[job.source_id]));
  let period=(await db.query('select * from scoring.periods where season_id=(select season_id from scoring.sources where id=$1) and start_date=$2',[job.source_id,iso(job.start_date)])).rows[0];
  if(!period)period=(await db.query('insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) select season_id,$2,$3,$4,$5,$6 from scoring.sources where id=$1 returning *',[job.source_id,d.scoring_scope,v.start,v.end,d.tournament_period,d.tournament_label??v.start])).rows[0];
  assert.equal(iso(period.end_date),v.end);assert.equal(period.source_period,d.tournament_period);
  const prior=(await db.query('select * from scoring.latest_results where period_id=$1 and owner_id=$2',[period.id,job.owner_id])).rows[0];
  // A commissioner correction is never erased by an unchanged raw capture.
  let priorRaw=prior?.payload?.scheduled_content_hash;
  if(prior&&!priorRaw){
   // Compare the original capture when an audited non-participation correction exists.
   // An identical raw response must not erase that commissioner confirmation.
   const original=prior.payload.correction_evidence?.original_result_id;
   const base=original?(await db.query('select payload from scoring.results where id=$1',[original])).rows[0]?.payload:prior.payload;
   if(base?.players)priorRaw=hash({players:[...base.players].sort((a,b)=>a.player_id.localeCompare(b.player_id)),starter_total:base.starter_total,bench_total:base.bench_total,events_finished:base.events_finished});
  }
  let rid=prior?.id;
  if(prior&&new Date(capture.observed_at)<new Date(prior.observed_at))throw Error('Stale capture');
  if(priorRaw!==contentHash){
   if(prior&&!prior.payload.scheduled_content_hash)throw Error('Manual scoring revision requires commissioner review before automation');
   const body={...semantic,period_id:period.id,owner_id:job.owner_id,team_id:job.team_id,observed_at:capture.observed_at,reason:prior?'Fantrax scoring correction':'Scheduled Fantrax scoring import',scheduled_content_hash:contentHash};
   rid=await one(db,'select scoring.import_result($1,$2,$3)',[randomUUID(),JSON.stringify(body),prior?.revision??0]);
  }
  await db.query('update scoring.jobs set result_id=$2,last_attempt=clock_timestamp(),last_error=null where id=$1',[job.id,rid]);
  const outcome=await one(db,'select scoring.evaluate($1,clock_timestamp())',[rid]);
  const last=await one(db,'select (select evidence from scoring.decisions where result_id=$1 order by evaluated_at desc,id desc limit 1)',[rid]);
  if(hash(last)!==hash(outcome))await one(db,'select scoring.record_decision($1,$2)',[randomUUID(),rid]);
  await db.query("insert into scoring.fetch_attempts(job_id,status,detail,result_id,content_hash) values($1,'success',$2,$3,$4)",[job.id,prior?.id===rid?'Unchanged capture':'New scoring revision',rid,contentHash]);
  await db.query('commit');return {job_id:job.id,result_id:rid,unchanged:prior?.id===rid,status:outcome.status};
 }catch(e){await db.query('rollback');throw e;}
}
export async function markPending(db,id,detail){
 // Only fixed safe diagnostic codes are stored; no HTTP body, cookie or SQL errors.
 assert.ok(['FETCH_FAILED','INCOMPLETE_RESPONSE','IMPORT_REVIEW_REQUIRED'].includes(detail));
 await db.query('begin');try{
  await db.query('select pg_advisory_xact_lock(731944,1)');
  await db.query('update scoring.jobs set last_attempt=clock_timestamp(),last_error=$2 where id=$1',[id,detail]);
  await db.query("insert into scoring.fetch_attempts(job_id,status,detail) values($1,'pending',$2)",[id,detail]);
  await db.query('commit');
 }catch(e){await db.query('rollback');throw e;}
}

