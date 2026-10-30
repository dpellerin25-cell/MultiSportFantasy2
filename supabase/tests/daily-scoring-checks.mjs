import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const requestId=h=>`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
const eastern=value=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
export function dailyCheckPlan(snapshots,finishedAt){
 assert.ok(Number.isFinite(Date.parse(finishedAt)),'Fetch completion timestamp required');
 assert.equal(snapshots.length,5);
 assert.equal([...new Set(snapshots.map(s=>s.sport))].sort().join(','),'EPL,MLB,NBA,NFL,PGA');
 const ends=eastern(finishedAt),day=`${ends.year}-${ends.month}-${ends.day}`;
 const observations=snapshots.map(s=>{const t=eastern(s.observed);return {...s,day:`${t.year}-${t.month}-${t.day}`,hour:t.hour};});
 assert.ok(observations.every(s=>Date.parse(s.observed)<=Date.parse(finishedAt)),'Completion cannot precede observation');
 // Cross-midnight reads cannot establish a single dated checkpoint.
 if(observations.some(s=>s.day!==day))return {skipped:'Roster reads cross Eastern dates; eligibility stays pending'};
 const complete=true;
 const owners=snapshots[0].rosters.map(r=>r.owner).sort();
 for(const s of snapshots)assert.deepEqual(s.rosters.map(r=>r.owner).sort(),owners);
 return {day,complete,owners,observations};
}

// Caller owns the trade-roster transaction and its membership/renewal lock.
// No commit here: failures roll back both roster reconciliation and count writes.
export async function storeDailyChecks(db,snapshots,finishedAt){
 const plan=dailyCheckPlan(snapshots,finishedAt);if(plan.skipped)return plan;
 await db.query('select pg_advisory_xact_lock(731944,1)');
 const result=[];
 for(const slug of plan.owners){
   const owners=(await db.query('select id from draft.owners where slug=$1 and active',[slug])).rows;
   assert.equal(owners.length,1,'Active scoring owner mapping required');const owner=owners[0].id;
   const sports=snapshots.map(s=>({sport:s.sport,count:s.rosters.find(r=>r.owner===slug).players.length,source_ref:`sha256:${hash(s)}`,observed_at:s.observed}));
   const body={owner_id:owner,check_date:plan.day,complete:plan.complete,timing_policy:'scheduled-observation-v2',observed_at:finishedAt,reason:'Scheduled daily roster observation at actual fetch completion time',sports};
   const req=requestId(hash({kind:'daily-scoring-count-v2',body}));
   const existing=(await db.query('select request_id,complete from scoring.roster_checks where owner_id=$1 and check_date=$2 order by revision desc limit 1',[owner,plan.day])).rows[0];
   // A rerun must never replace the original checkpoint with a later roster.
   if(existing&&existing.request_id!==req){result.push({owner:slug,status:'existing_check_preserved',complete:existing.complete});continue;}
   await db.query('select scoring.record_roster_check($1,$2,0)',[req,JSON.stringify(body)]);
   result.push({owner:slug,status:existing?'already_recorded':'recorded',complete:true});
 }
 return {check_date:plan.day,complete:result.every(r=>r.complete),owners:result};
}
