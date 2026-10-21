import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {applyRenewal,previewRenewal,runtimeRegistry,checksum,automaticAllowed,reviewedEvidence,checkCapture} from './yearly-renewal.mjs';
const baseline=JSON.parse(await readFile(new URL('../../scripts/fantrax-connections.json',import.meta.url),'utf8'));
const policy=JSON.parse(await readFile(new URL('../../scripts/fantrax-renewal-policy.json',import.meta.url),'utf8'));
for(const sport of ['NFL','MLB','NBA','EPL','PGA']){
 assert.equal(automaticAllowed({sport,season_year:2099},policy),true);
 assert.equal(policy.sports[sport].standings_release,undefined);
 policy.sports[sport].mode='manual'; // Exercise explicit approval independently.
}
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 assert.equal((await db.query("select trading.verified_championship_year('MLB',2027) y")).rows[0].y,2027);
 await assert.rejects(()=>db.query("select trading.verified_championship_year('MLB',2026)"),/Pre-launch/);
 for(const sport of ['NFL','NBA','EPL','PGA']) {
  assert.equal((await db.query('select trading.verified_championship_year($1,2027) y',[sport])).rows[0].y,2027);
  await assert.rejects(()=>db.query('select trading.verified_championship_year($1,2026)',[sport]),/Pre-launch/);
 }
 const settings={owners:(await db.query('select slug from draft.owners where active order by slug')).rows};
 await db.exec("insert into draft.players(sport,name) values('MLB','Fixture');insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fantrax','60ri2nbhmtj4b0km','001' from draft.players;");
 const capture={schema_version:1,capture_checks_passed:true,sport:'MLB',old_league_id:'60ri2nbhmtj4b0km',new_league_id:'rk8bvnk3mulovx9a',standings_league_id:'60ri2nbhmtj4b0km',history_id:'ml3fdlq2mulovxoh',old_season_year:2026,season_year:2027,
 standings_championship_year:2027,started_at:new Date(Date.now()-2000).toISOString(),completed_at:new Date(Date.now()-1000).toISOString(),pool_summary:{complete:true,unknown_status_count:0,unique_available_players:1},players:[{player_id:'001',player_name:'Fixture'}],rosters:settings.owners.map(o=>({owner:o.slug,players:[]}))};
 const registry=await runtimeRegistry(db,baseline);
 const stale={...capture,started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:01:00Z'};
 const audit=await previewRenewal(db,stale,registry,settings,policy,{auditOnly:true});
 assert.equal(audit.audit_only,true);assert.equal(audit.activation_authorized,false);assert.equal(audit.plan_hash,undefined);
 await assert.rejects(()=>previewRenewal(db,stale,registry,settings,policy));
 await assert.rejects(()=>applyRenewal(db,stale,baseline,settings,policy,{approval:checksum(stale)}));
 await assert.rejects(()=>previewRenewal(db,{...stale,completed_at:'2999-01-01T00:00:00Z'},registry,settings,policy,{auditOnly:true}));
 assert.equal((await db.query('select count(*)::int n from trading.fantrax_transition_log')).rows[0].n,0);
 for(const mutate of [c=>c.new_league_id='xtv5ph2gmulolm8g',c=>c.old_league_id='abcdefghijklmnop',c=>c.season_year=2029,c=>c.rosters.pop(),c=>c.players.push(c.players[0]),c=>c.started_at='2000-01-01T00:00:00Z']){
   const bad=structuredClone(capture);mutate(bad);assert.throws(()=>checkCapture(bad,registry,settings));
 }
 const auto=structuredClone(policy);auto.sports.MLB={mode:'automatic',automatic_month_day:'01-01'};
 assert.equal(automaticAllowed(capture,auto,Date.UTC(2027,0,2)),true);
 assert.equal(automaticAllowed(capture,auto,Date.UTC(2026,11,31)),false);
 auto.sports.MLB.automatic_month_day='02-30';assert.equal(automaticAllowed(capture,auto,Date.UTC(2027,3,1)),false);
 assert.deepEqual((await previewRenewal(db,capture,registry,settings,policy)).blockers,[]);
 const renamed=structuredClone(capture);renamed.players[0].player_name='Different captured name';
 const diagnostic=await previewRenewal(db,renamed,registry,settings,policy);
 assert.deepEqual(diagnostic.blockers,[]);
 assert.equal(diagnostic.warnings[0].issue,'unowned_name_difference');
 await db.exec('begin');
 await db.query('select trading.apply_fantrax_renewal($1,$2)',[JSON.stringify(renamed),checksum(renamed)]);
 assert.equal((await db.query('select count(*)::int n from draft.player_source_ids where league_id=$1',[capture.new_league_id])).rows[0].n,0);
 assert.equal((await db.query('select name from draft.players')).rows[0].name,'Fixture');
 await db.exec('rollback');
 // Identical mismatch must block if the player is owned, even with an override.
 await db.exec('begin');
 const ownedRosters=capture.rosters.map(r=>({...r,players:r.owner==='doug'?[{player_id:'001',name:'Fixture'}]:[]}));
 await db.query("select trading.ingest_rosters('MLB',$1,clock_timestamp()-interval '1 day',$2)",[capture.old_league_id,JSON.stringify(ownedRosters)]);
 const ownedReport=await previewRenewal(db,renamed,registry,settings,policy);
 assert.deepEqual(ownedReport.protected_name_mismatches,['001']);
 const missingOwned={...capture,players:[{player_id:'different',player_name:'Different player'}]};
 assert.deepEqual((await previewRenewal(db,missingOwned,registry,settings,policy)).protected_missing_ids,['001']);
 await assert.rejects(()=>db.query('select trading.apply_fantrax_renewal($1,$2)',[JSON.stringify(renamed),checksum(renamed)]),/Protected/);
 await db.exec('rollback');
 // Formerly rostered but now unowned historical trade records do not block.
 await db.exec('begin');
 await db.query("select trading.ingest_rosters('MLB',$1,clock_timestamp()-interval '2 days',$2)",[capture.old_league_id,JSON.stringify(ownedRosters)]);
 await db.query("select trading.ingest_rosters('MLB',$1,clock_timestamp()-interval '1 day',$2)",[capture.old_league_id,JSON.stringify(capture.rosters)]);
 assert.deepEqual((await previewRenewal(db,renamed,registry,settings,policy)).blockers,[]);
 await db.query('select trading.apply_fantrax_renewal($1,$2)',[JSON.stringify(renamed),checksum(renamed)]);
 assert.equal((await db.query('select league_id from trading.players')).rows[0].league_id,capture.old_league_id);
 await db.exec('rollback');
 assert.equal(diagnostic.identity_difference_details[0].stored_records[0].name,'Fixture');
 assert.equal(diagnostic.identity_difference_details[0].captured_name,'Different captured name');
 assert.equal(diagnostic.identity_difference_details[0].stored_records[0].active_selections,0);
 assert.deepEqual(diagnostic.membership.missing_from_database,[]);
 assert.equal(automaticAllowed(capture,policy),false);
 await assert.rejects(()=>applyRenewal(db,capture,baseline,settings,policy,{automatic:true}));
 await assert.rejects(()=>applyRenewal(db,capture,baseline,settings,policy,{approval:'wrong'}));
 assert.equal((await db.query('select count(*)::int n from trading.league_renewals')).rows[0].n,0);
 const result=await applyRenewal(db,capture,baseline,settings,policy,{approval:checksum(capture)});
 assert.equal(result.applied,true);assert.equal(result.standings_unchanged,true);
 assert.equal((await applyRenewal(db,capture,baseline,settings,policy,{approval:checksum(capture)})).already_applied,true);
 const after=await runtimeRegistry(db,baseline);
 assert.equal(after.sports.MLB.current_league_id,capture.new_league_id);assert.equal(after.sports.MLB.standings_league_id,capture.old_league_id);
 // A second annual renewal retains the original standings until archive release.
 const next={...capture,old_league_id:capture.new_league_id,new_league_id:'abcdefghijklmnop',old_season_year:2027,season_year:2028,started_at:new Date().toISOString(),completed_at:new Date().toISOString()};
 await db.exec("insert into draft.players(sport,name) values('MLB','Historical only');insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fantrax','rk8bvnk3mulovx9a','002' from draft.players where name='Historical only';");
 const missingReport=await previewRenewal(db,next,after,settings,policy);
 assert.equal(missingReport.missing_player_details[0].player_id,'002');
 assert.equal(missingReport.missing_player_details[0].stored_records[0].name,'Historical only');
 assert.equal(missingReport.missing_player_details[0].captured_name,null);
 assert.deepEqual(missingReport.blockers,[]);
 assert.equal(missingReport.warnings[0].issue,'unowned_absent');
 const reviewed=structuredClone(policy);reviewed.sports.MLB.reviewed_absent_ids={'002':'Reviewed absent retired identity; retain history'};
 assert.equal((await applyRenewal(db,next,baseline,settings,reviewed,{approval:checksum(reviewedEvidence(next,reviewed))})).applied,true);
 const final=await runtimeRegistry(db,baseline);assert.equal(final.sports.MLB.current_season_year,2028);assert.equal(final.sports.MLB.standings_league_id,capture.old_league_id);
 assert.equal((await db.query('select count(*)::int n from trading.fantrax_transition_log')).rows[0].n,2);
 await db.exec('begin');
 await db.query('select trading.release_initial_fantrax_standings($1,$2,$3,$4,$5)',['MLB',capture.old_league_id,next.new_league_id,'a'.repeat(64),'Old league was only a setup test, not a championship']);
 assert.equal((await runtimeRegistry(db,baseline)).sports.MLB.standings_league_id,next.new_league_id);
 await db.exec('rollback');
 await db.query('select trading.release_fantrax_standings($1,$2,$3,$4,$5)',['MLB',capture.old_league_id,next.new_league_id,2027,'b'.repeat(64)]);
 await db.query('select trading.release_fantrax_standings($1,$2,$3,$4,$5)',['MLB',capture.old_league_id,next.new_league_id,2027,'b'.repeat(64)]);
 assert.equal((await db.query('select count(*)::int n from trading.fantrax_standings_releases')).rows[0].n,1);
 for(const [i,sport] of ['NFL','NBA','EPL','PGA'].entries()){
   const old=baseline.sports[sport].current_league_id;
   const c={...capture,sport,old_league_id:old,standings_league_id:old,new_league_id:`abcdefghijklmn0${i}`,history_id:'abcdefghijklmnop',started_at:new Date().toISOString(),completed_at:new Date().toISOString()};
   const detected=structuredClone(policy);detected.sports[sport]={mode:'automatic',activation:'on_detection'};
   assert.equal((await applyRenewal(db,c,baseline,settings,detected,{automatic:true})).applied,true);
   assert.equal((await runtimeRegistry(db,baseline)).sports[sport].current_league_id,c.new_league_id);
   assert.equal((await runtimeRegistry(db,baseline)).sports[sport].standings_league_id,old);
 }
 await db.exec('set role authenticated');await assert.rejects(()=>db.query('select trading.apply_fantrax_renewal($1,$2)',[JSON.stringify(capture),checksum(capture)]),/permission denied/);await db.exec('reset role');
 console.log('PASS generic renewal approval/automatic gates, rollback, two yearly transitions, retained standings, retry and role denial');
}finally{await db.close();}

