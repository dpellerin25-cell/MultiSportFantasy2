import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {requireRenewalArchive} from './renewal-archive-gate.mjs';
export const checksum=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const SPORTS=['NFL','MLB','NBA','EPL','PGA'];
export function reviewedEvidence(c,policy){
 const reviews=policy.sports[c.sport]?.reviewed_absent_ids??{};
 assert.ok(reviews&&typeof reviews==='object'&&!Array.isArray(reviews));
 for(const [id,reason] of Object.entries(reviews))assert.ok(/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&typeof reason==='string'&&reason.trim().length>=10);
 return Object.keys(reviews).length?{...c,reviewed_absent_ids:reviews}:c;
}
export function checkCapture(c,registry,settings,now=Date.now(),{auditOnly=false}={}){
 assert.equal(c.schema_version,1);assert.equal(c.capture_checks_passed,true);assert.ok(SPORTS.includes(c.sport));
 const current=registry.sports[c.sport];
 assert.equal(c.old_league_id,current.current_league_id,'Stale source connection');
 assert.equal(c.standings_league_id,current.standings_league_id??current.current_league_id,'Standings connection changed');
 assert.equal(c.standings_championship_year,current.standings_championship_year??registry.championship_year,'Standings championship year changed');
 assert.ok(/^[a-z0-9]{16}$/.test(c.new_league_id)&&c.new_league_id!==c.old_league_id&&!registry.excluded_league_ids.includes(c.new_league_id));
 assert.ok(/^[a-z0-9]{16}$/.test(c.history_id));
 if(current.league_history_id)assert.equal(c.history_id,current.league_history_id);
 assert.equal(c.old_season_year,current.current_season_year??2026);
 assert.equal(c.season_year,c.old_season_year+1);
 assert.ok(Number.isInteger(c.season_year)&&c.season_year<=2200);
 const start=Date.parse(c.started_at),end=Date.parse(c.completed_at);
 assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=now,'Invalid capture timestamps');
 if(!auditOnly)assert.ok(start>=now-21600000,'Capture older than six hours');
 assert.equal(c.pool_summary?.complete,true);assert.equal(c.pool_summary?.unknown_status_count,0);
 assert.ok(Array.isArray(c.players)&&c.players.length>0&&c.players.length<=100000);
 const ids=new Set();
 for(const p of c.players){assert.ok(typeof p.player_id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.player_id)&&typeof p.player_name==='string'&&p.player_name.trim());assert.ok(!ids.has(p.player_id));ids.add(p.player_id);}
 assert.ok(Array.isArray(c.rosters));
 assert.deepEqual(c.rosters.map(r=>r.owner).sort(),settings.owners.map(o=>o.slug).sort());
 const rostered=new Set();
 for(const r of c.rosters){assert.ok(Array.isArray(r.players));for(const p of r.players){assert.ok(ids.has(p.player_id)&&!rostered.has(p.player_id));assert.equal(c.players.find(x=>x.player_id===p.player_id).player_name,p.name);rostered.add(p.player_id);}}
 assert.equal(c.players.length,c.pool_summary.unique_available_players+rostered.size);
 return c;
}

export async function runtimeRegistry(db,baseline){
 const registry=structuredClone(baseline);
 const states=(await db.query('select * from trading.fantrax_state')).rows;
 const legacy=(await db.query('select * from trading.league_renewals')).rows;
 for(const [sport,value] of Object.entries(registry.sports)){
   value.current_season_year??=2026;
   value.standings_league_id??=value.current_league_id;
   value.standings_championship_year??=registry.championship_year;
   const state=states.find(s=>s.sport===sport),previous=legacy.find(s=>s.sport===sport);
   if(state){value.current_league_id=state.league_id;value.current_season_year=state.season_year;value.standings_league_id=state.standings_league_id;value.standings_championship_year=state.standings_championship_year;value.league_history_id=state.history_id;}
   else if(previous){
     // Only the existing verified 2026->2027 MLB helper can predate generic state.
     assert.equal(sport,'MLB');assert.equal(previous.old_league_id,'60ri2nbhmtj4b0km');assert.equal(previous.new_league_id,'rk8bvnk3mulovx9a');
     value.current_league_id=previous.new_league_id;value.current_season_year=2027;value.league_history_id=previous.history_id;
   }
 }
 return registry;
}

export async function previewRenewal(db,c,registry,settings,policy,{auditOnly=false}={}){
 c=reviewedEvidence(c,policy);
 checkCapture(c,registry,settings,Date.now(),{auditOnly});
 const rule=policy.sports[c.sport];assert.ok(['disabled','manual','automatic'].includes(rule.mode));
 const blockers=[];
 if(rule.mode==='disabled')blockers.push('Renewals disabled for this sport');
 const expected=settings.owners.map(o=>o.slug).sort();
 const actual=(await db.query('select slug from draft.owners where active order by slug')).rows.map(o=>o.slug);
 if(JSON.stringify(actual)!==JSON.stringify(expected))blockers.push('Database and website membership differ');
 const ids=new Map(c.players.map(p=>[p.player_id,p.player_name.trim().toLowerCase()]));
 const sources=(await db.query(`select src.external_player_id,p.name,p.sport,
 (select count(*)::int from draft.draft_selections d where d.player_id=p.id and d.voided_at is null) active_selections,
 (select count(*)::int from draft.draft_pool_players d where d.player_id=p.id) frozen_pool_references
 from draft.player_source_ids src join draft.players p on p.id=src.player_id where src.provider='fantrax' and src.league_id=$1`,[c.old_league_id])).rows;
 const trades=(await db.query('select fantrax_id external_player_id,name,sport from trading.players where league_id=$1',[c.old_league_id])).rows;
 const ownership=(await db.query(`select p.fantrax_id,o.slug owner,
 (select dest.slug from trading.player_reservations r join trading.assets a on a.trade_id=r.trade_id and a.player_id=p.id join draft.owners dest on dest.id=a.to_owner_id where r.player_id=p.id) expected_transfer
 from trading.players p join draft.owners o on o.id=p.owner_id where p.league_id=$1`,[c.old_league_id])).rows;
 const capturedOwners=new Map(c.rosters.flatMap(r=>r.players.map(p=>[p.player_id,r.owner])));
 if(ownership.some(p=>capturedOwners.get(p.fantrax_id)!==p.owner&&(!p.expected_transfer||capturedOwners.get(p.fantrax_id)!==p.expected_transfer)))blockers.push('Owned players are missing or unexpectedly reassigned in renewed rosters; verify Fantrax carryover first');
 const absent=[...new Set([...sources,...trades].filter(p=>!ids.has(p.external_player_id)).map(p=>p.external_player_id))].sort();
 const mismatch=[...new Set([...sources,...trades].filter(p=>p.sport!==c.sport||(ids.has(p.external_player_id)&&ids.get(p.external_player_id)!==p.name.trim().toLowerCase())).map(p=>p.external_player_id))].sort();
 const protectedIds=(await db.query('select external_id from trading.renewal_protected_ids($1)',[c.old_league_id])).rows.map(r=>r.external_id);
 const protectedMissing=absent.filter(id=>protectedIds.includes(id));
 const protectedMismatch=mismatch.filter(id=>protectedIds.includes(id));
 if(protectedMissing.length)blockers.push('Owned, traded or non-retired drafted player IDs are absent from capture');
 if(protectedMismatch.length)blockers.push('Owned, traded or non-retired drafted player names differ from capture');
 if([...sources,...trades].some(p=>p.sport!==c.sport))blockers.push('Stored source sport differs from league');
 const warnings=[...absent.filter(id=>!protectedIds.includes(id)).map(id=>({player_id:id,issue:'unowned_absent',action:'retain historical identity'})),
 ...mismatch.filter(id=>!protectedIds.includes(id)).map(id=>({player_id:id,issue:'unowned_name_difference',action:'do not alias; use separate new-season identity'}))];
 const dest=(await db.query("select count(*)::int n from draft.player_source_ids where provider='fantrax' and league_id=$1",[c.new_league_id])).rows[0].n;
 if(dest)blockers.push('Destination source identities already exist');
 const planHash=checksum(c);
 const details=id=>({player_id:id,stored_records:[...sources.map(p=>({...p,source:'draft'})),...trades.map(p=>({...p,source:'trade'}))].filter(p=>p.external_player_id===id).map(({external_player_id,...p})=>p),captured_name:c.players.find(p=>p.player_id===id)?.player_name??null});
 return {...(auditOnly?{audit_only:true,activation_authorized:false,capture_completed_at:c.completed_at,scope:'Saved evidence compared with current database; not a live Fantrax verification. Run a fresh preview before activation.'}:{plan_hash:planHash}),sport:c.sport,old_league_id:c.old_league_id,new_league_id:c.new_league_id,
   season_year:c.season_year,stored_sources:sources.length,missing_ids:absent,name_or_sport_mismatches:mismatch,
   membership:{website_owners:expected,database_active_owners:actual,missing_from_database:expected.filter(o=>!actual.includes(o)),database_only:actual.filter(o=>!expected.includes(o))},
   missing_player_details:absent.map(details),identity_difference_details:mismatch.map(details),
   protected_missing_ids:protectedMissing,protected_name_mismatches:protectedMismatch,warnings,
   blockers,standings_unchanged:true,mode:rule.mode};
}

export function automaticAllowed(c,policy,now=Date.now()){
 const p=policy.sports[c.sport];
 if(p.mode!=='automatic')return false;
 const trigger=p.activation??'on_date';
 if(trigger==='on_detection')return true;
 if(trigger!=='on_date'||typeof p.automatic_month_day!=='string'||!/^\d{2}-\d{2}$/.test(p.automatic_month_day))return false;
 const date=`${c.season_year}-${p.automatic_month_day}`;
 const due=Date.parse(date+'T00:00:00Z');
 return Number.isFinite(due)&&new Date(due).toISOString().slice(0,10)===date&&now>=due;
}

export async function applyRenewal(db,c,baseline,settings,policy,{automatic=false,approval}={}){
 c=reviewedEvidence(c,policy);
 await db.query('begin');
 try{
   await db.query("set local statement_timeout='120s'");await db.query("set local lock_timeout='30s'");
   await db.query('select pg_advisory_xact_lock(731943,1)');await db.query('select pg_advisory_xact_lock(20260925,1)');
   const hash=checksum(c);
   const prior=(await db.query('select 1 from trading.fantrax_transition_log where plan_hash=$1',[hash])).rows;
   if(prior.length){await db.query('rollback');return {already_applied:true,plan_hash:hash};}
   const registry=await runtimeRegistry(db,baseline);
   const report=await previewRenewal(db,c,registry,settings,policy);
   assert.deepEqual(report.blockers,[],'Resolve preview blockers');
   if(automatic){
     assert.ok(automaticAllowed(c,policy),'Automatic activation not enabled or not yet due');
     await requireRenewalArchive(c);
   }
   else assert.equal(approval,report.plan_hash,'Exact preview hash approval required');
   const result=(await db.query('select trading.apply_fantrax_renewal($1,$2) result',[JSON.stringify(c),hash])).rows[0].result;
   await db.query('commit');return {...report,...result};
 }catch(e){await db.query('rollback');throw e;}
}
