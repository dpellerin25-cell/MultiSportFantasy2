import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {auditMLB,validateManifest,OLD,NEXT} from './mlb-identity-audit.mjs';
const players=[{player_id:'001',player_name:'One'},{player_id:'002',player_name:'Two'}];
const manifest={schema_version:1,kind:'mlb-renewal-identities',capture_checks_passed:true,started_at:'2026-01-01T00:00:00Z',completed_at:'2026-01-01T00:01:00Z',leagues:{
 [OLD]:{metadata:{league_history_id:'ml3fdlq2mulovxoh',season_year:2026},player_count:2,players},
 [NEXT]:{metadata:{league_history_id:'ml3fdlq2mulovxoh',season_year:2027},player_count:2,players:[players[0],{player_id:'003',player_name:'Three'}]}}};
for(const mutate of [m=>m.capture_checks_passed=false,m=>m.leagues[NEXT].players.push(players[0]),m=>m.leagues[NEXT].metadata.season_year=2026,m=>m.leagues[OLD].players[0].player_id=1,m=>m.completed_at='bad']){
 const m=structuredClone(manifest);mutate(m);assert.throws(()=>validateManifest(m));
}
// Minimal read-model tables exercise SQL joins/reference counts. No mutation functions are under test.
const db=await PGlite.create();
try{
 await db.exec(`create schema draft;create schema trading;
 create table draft.players(id text,sport text,name text);
 create table draft.player_source_ids(player_id text,provider text,league_id text,external_player_id text);
 create table draft.draft_selections(player_id text,voided_at timestamptz);
 create table draft.draft_pool_players(player_id text);
 create table trading.players(id text,fantrax_id text,name text,owner_id text,sport text,league_id text);
 create table trading.assets(trade_id text,player_id text);create table trading.trades(id text,status text);
 insert into draft.players values('p1','MLB','One'),('p2','MLB','Two');
 insert into draft.player_source_ids values('p1','fantrax','${OLD}','001'),('p2','fantrax','${OLD}','002');
 insert into draft.draft_selections values('p2',null),('p2',now());
 insert into draft.draft_pool_players values('p2');
 insert into trading.players values('t2','002','Two','owner','MLB','${OLD}');
 insert into trading.trades values('trade','accepted');insert into trading.assets values('trade','t2');`);
 await db.exec('begin read only');
 const report=await auditMLB(db,manifest);
 await db.exec('rollback');
 assert.equal(report.counts.stored_old_sources,2);
 assert.equal(report.counts.stored_ids_absent_from_new,1);
 assert.equal(report.counts.absent_ids_with_active_selections,1);
 assert.deepEqual(report.absent_stored_players[0],{player_id:'002',player_name:'Two',present_in_old_capture:true,active_selections:1,voided_selections:1,frozen_pool_references:1});
 assert.equal(report.missing_trade_players[0].pending_trade_references,1);
 assert.equal(report.capture_new_only[0].player_id,'003');
 assert.equal(report.blockers.length,2);
 const complete=structuredClone(manifest);complete.leagues[NEXT].players=players;
 assert.deepEqual((await auditMLB(db,complete)).blockers,[]);
 await db.exec(`insert into draft.player_source_ids values('p2','fantrax','${NEXT}','001')`);
 assert.ok((await auditMLB(db,manifest)).blockers.some(b=>b.includes('Destination')));
 assert.equal((await db.query('select count(*)::int n from draft.players')).rows[0].n,2);
 console.log('PASS manifest validation, read-only SQL comparison, active/voided/frozen draft references, trade references, destination guard and no identity changes');
}finally{await db.close();}
