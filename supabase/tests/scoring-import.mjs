import {createHash} from 'node:crypto';
import {CONFIRMATION_ID,confirmedCase} from './scoring-nonparticipation.mjs';
export class ScoringImportError extends Error {}
const demand=(ok,message)=>{if(!ok)throw new ScoringImportError(message);};
const text=v=>typeof v==='string'&&v.trim().length>0;
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
export function validateScoringImport(envelope){
 const e=envelope,d=e?.diagnostic;
 demand(e?.version===1&&e?.is_test===true,'Only version 1 explicitly marked test imports are supported.');
 demand(Number.isInteger(e.season_year)&&e.season_year>=2000&&e.season_year<=2200,'Explicit season_year required.');
 demand(Number.isInteger(e.expected_revision)&&e.expected_revision>=0,'Explicit nonnegative expected_revision required.');
 demand(text(e.reason),'An import/correction reason is required.');
 demand(typeof e.observed_at==='string'&&/T.*(Z|[+-]\d\d:\d\d)$/.test(e.observed_at)&&Number.isFinite(Date.parse(e.observed_at))&&Date.parse(e.observed_at)<=Date.now(),'A real, nonfuture observation timestamp with timezone is required.');
 demand(d?.historical_test_data===true&&d.production_ready===false&&d.read_only===true&&d.totals_reconcile===true,'Use the shared historical scoring diagnostic output.');
 demand(['NFL','MLB','NBA','EPL','PGA'].includes(d.sport),'Unsupported sport.');
 demand([d.league_id,d.team_id,d.owner].every(text),'League, team and owner are required.');
 const pga=d.sport==='PGA';
 demand(d.scoring_scope===(pga?'tournament':'day'),'Scoring scope differs from sport.');
 demand(pga?(Number.isInteger(d.tournament_period)&&d.tournament_period>0&&text(d.tournament_label)&&d.scoring_date===null):(date(d.scoring_date)&&d.tournament_period===null&&d.all_events_finished===true),'Invalid scope or unfinished daily results.');
 demand(pga?[true,null,undefined].includes(d.all_events_finished):true,'Explicitly unfinished PGA results cannot be imported.');
 const start=pga?e.tournament_start:d.scoring_date;
 demand(date(start),'PGA needs an explicit verified tournament_start date.');
 if(pga){
   demand(new Date(start).getUTCDay()===4,'Tournament start must be Thursday.');
   const display=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',timeZone:'UTC'}).format(new Date(start));
   demand(d.tournament_label.includes(`(Thu ${display})`),'Tournament start does not match the captured period label.');
 }
 const end=pga?new Date(Date.parse(start)+3*86400000).toISOString().slice(0,10):start;
 demand(Number(start.slice(0,4))>=e.season_year&&Number(end.slice(0,4))<=e.season_year+(['NFL','NBA','EPL'].includes(d.sport)?1:0),'Dates are outside the explicit season.');
 demand(Date.parse(e.observed_at)>=Date.parse(start),'Observation predates the scoring period.');
 demand(finite(d.active_total)&&finite(d.bench_total)&&Array.isArray(d.players),'Numeric totals and player records required.');
 let active=0,bench=0;const ids=new Set();
 const players=d.players.map(p=>{
   demand(text(p.player_id)&&text(p.player_name)&&!ids.has(p.player_id),'Missing or duplicate player identity.');ids.add(p.player_id);
   demand(['sport','league_id','team_id','owner','scoring_date','tournament_period'].every(k=>p[k]===d[k]),'Player identity or scoring scope differs from diagnostic.');
   demand(['ACTIVE','BENCH'].includes(p.lineup_group),'Unknown lineup group.');
   demand(p.stat_record_present===true?finite(p.fantasy_points):p.stat_record_present===false&&p.fantasy_points===null,'Missing scores must stay null; explicit scores must be numeric.');
   demand(p.team_contribution===(p.lineup_group==='BENCH'?0:p.fantasy_points),'Incorrect starter contribution.');
   if(p.lineup_group==='ACTIVE')active+=p.fantasy_points??0;else bench+=p.fantasy_points??0;
   return {player_id:p.player_id,player_name:p.player_name,lineup:p.lineup_group,points:p.fantasy_points,state:p.stat_record_present?'known':'unknown'};
 });
 demand(Math.abs(active-d.active_total)<1e-8&&Math.abs(bench-d.bench_total)<1e-8,'Individual scores do not reconcile.');
 let original;
 if(e.non_participation_confirmation){
   const confirmation=e.non_participation_confirmation,c=confirmedCase(d);
   demand(confirmation.id===CONFIRMATION_ID&&c,'No commissioner confirmation exists for this exact owner, league and period.');
   demand(confirmation.original_envelope&&!confirmation.original_envelope.non_participation_confirmation,'Original uncorrected import envelope required.');
   original=validateScoringImport(confirmation.original_envelope);
   demand(hash(original.d)===hash(d)&&original.e.season_year===e.season_year&&original.e.tournament_start===e.tournament_start,'A confirmation cannot alter raw Fantrax evidence or season scope.');
   demand(e.expected_revision===original.e.expected_revision+1&&Date.parse(e.observed_at)>Date.parse(original.e.observed_at),'Confirmation must follow the original revision and capture time.');
   for(const [id,name] of Object.entries(c.players)){
     const p=players.find(p=>p.player_id===id);
     demand(p&&p.player_name===name&&p.lineup==='ACTIVE'&&p.state==='unknown','Only the explicitly confirmed missing starter records may be corrected.');
     p.state='no_activity';
     p.evidence=JSON.stringify({confirmation_id:CONFIRMATION_ID,source:'commissioner conversation',confirmed_by:'Doug',confirmed_on:'2026-10-29',recorded_at:e.observed_at,statement:'I can confirm all of those players did not participate in that given day/period',original_capture_observed_at:original.e.observed_at,original_checksum:original.checksum});
   }
 }
 const checksum=hash(e), raw=hash({kind:'historical-scoring-import-v1',checksum});
 const request_id=`${raw.slice(0,8)}-${raw.slice(8,12)}-5${raw.slice(13,16)}-a${raw.slice(17,20)}-${raw.slice(20,32)}`;
 return {e,d,start,end,players,checksum,request_id,original};
}

// Both modes execute identical validations in a transaction. Preview rolls back;
// import requires its reviewed plan hash. No automatic migrations/account grants.
export async function importScoring(db,envelope,{apply=false,approval}={}){
 const v=validateScoringImport(envelope),{e,d,start,end}=v;
 const one=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
 await db.query('begin');
 try{
   await db.query("set local statement_timeout='15s'");
   await db.query("set local lock_timeout='5s'");
   await db.query('select pg_advisory_xact_lock(731944,1)');
   const owner=(await db.query('select id from draft.owners where display_name=$1',[d.owner])).rows;
   demand(owner.length===1,'Diagnostic owner must exactly match one existing website owner.');
   let season=(await db.query('select * from scoring.seasons where sport=$1 and league_id=$2',[d.sport,d.league_id])).rows[0];
   if(season)demand(season.is_test&&season.championship_year===null&&season.season_year===e.season_year,'Existing season scope differs; production data cannot be changed.');
   else season=(await db.query('insert into scoring.seasons(sport,league_id,season_year,is_test) values($1,$2,$3,true) returning *',[d.sport,d.league_id,e.season_year])).rows[0];
   let period=(await db.query('select * from scoring.periods where season_id=$1 and (start_date=$2 or source_period=$3)',[season.id,start,d.tournament_period])).rows[0];
   if(period){
     const iso=v=>v instanceof Date?v.toISOString().slice(0,10):v;
     demand(iso(period.start_date)===start&&iso(period.end_date)===end&&period.scope===d.scoring_scope&&period.source_period===d.tournament_period,'Existing period differs from reviewed capture.');
   }else period=(await db.query('insert into scoring.periods(season_id,scope,start_date,end_date,source_period,label) values($1,$2,$3,$4,$5,$6) returning *',[season.id,d.scoring_scope,start,end,d.tournament_period,d.tournament_label??start])).rows[0];
   const prior=(await db.query('select id from scoring.results where request_id=$1',[v.request_id])).rows[0];
   const latest=Number(await one('select coalesce(max(revision),0) from scoring.results where period_id=$1 and owner_id=$2',[period.id,owner[0].id]));
   // Expected revision is part of the checksum. Keep approval stable for an
   // exact retry after an uncertain commit; the SQL command rejects stale edits.
   const plan_hash=hash({checksum:v.checksum,owner:owner[0].id});
   demand(!apply||approval===plan_hash,'Approval does not match current preview; preview again.');
   const payload={period_id:period.id,owner_id:owner[0].id,team_id:d.team_id,observed_at:e.observed_at,starter_total:d.active_total,bench_total:d.bench_total,events_finished:d.all_events_finished===true,reason:e.reason,players:v.players};
   if(v.original){
     const base=(await db.query('select id,revision from scoring.results where request_id=$1',[v.original.request_id])).rows[0];
     demand(base&&Number(base.revision)===e.expected_revision,'The exact original capture must already be imported at the expected revision.');
     payload.correction_evidence={confirmation_id:CONFIRMATION_ID,original_result_id:base.id,original_checksum:v.original.checksum,original_observed_at:v.original.e.observed_at,evidence_recorded_at:e.observed_at};
   }
   const result=await one('select scoring.import_result($1,$2,$3)',[v.request_id,JSON.stringify(payload),e.expected_revision]);
   const superseded=Number(await one('select revision from scoring.results where id=$1',[result]))<latest;
   const outcome=superseded?{status:'superseded'}:await one('select scoring.evaluate($1,clock_timestamp())',[result]);
   const summary={mode:apply?'import':'preview',is_test:true,championship_year:null,plan_hash,checksum:v.checksum,already_imported:!!prior,sport:d.sport,owner:d.owner,league_id:d.league_id,start_date:start,end_date:end,player_records:v.players.length,starter_total:d.active_total,bench_total:d.bench_total,missing_records:v.players.filter(p=>p.state==='unknown').length,confirmed_non_participants:v.players.filter(p=>p.state==='no_activity').map(p=>({player_id:p.player_id,player_name:p.player_name,contribution:0})),revision:Number(await one('select revision from scoring.results where id=$1',[result])),outcome};
   await db.query(apply?'commit':'rollback');return summary;
 }catch(e){await db.query('rollback');throw e;}
}
