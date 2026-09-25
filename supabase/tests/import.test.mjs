import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {LEAGUES,validateExport,importPool} from './player-pool-import.mjs';
const timestamp='2026-09-25T12:00:00+00:00';
function fixture(){
  const sports={},players=[];
  for(const [sport,league_id] of Object.entries(LEAGUES)){
    players.push({sport,league_id,player_id:'001',player_name:'Fixture '+sport,position:null,professional_team:null,availability_status:'free_agent'});
    sports[sport]={league_id,complete:true,availability_filter:'ALL_AVAILABLE',effective_position_filter:{NFL:'FOOTBALL_OFFENSE',MLB:'ALL',NBA:'BASKETBALL_PLAYER',EPL:'ALL',PGA:'POS_500'}[sport],started_at:timestamp,completed_at:timestamp,pages_retrieved:1,raw_player_records:1,unique_available_players:1,reported_total:1,duplicate_records_removed:0,free_agent_count:1,waiver_count:0,identified_free_agents:1,identified_waiver_players:0,unknown_status_count:0,roster_snapshot_ids_checked:0};
  }
  return {schema_version:1,source:'Fantrax getPlayerStats',complete:true,started_at:timestamp,completed_at:timestamp,total_players:5,sports,players};
}
const bytes=x=>Buffer.from(JSON.stringify(x));
assert.equal(validateExport(bytes(fixture())).players.length,5);
for(const mutate of [x=>x.complete=false,x=>delete x.sports.PGA,x=>x.players.push(x.players[0]),x=>x.players[0].player_id=1,x=>x.players[0].league_id='bad',x=>x.players[0].availability_status='unknown',x=>x.sports.NFL.reported_total=2,x=>x.sports.MLB.free_agent_count=0,x=>x.sports.NBA.pages_retrieved=0,x=>x.completed_at='bad',x=>x.sports.EPL.effective_position_filter='POS_1']){
  const f=fixture();mutate(f);assert.throws(()=>validateExport(bytes(f)));
}
console.log('PASS export validation rejects incomplete, duplicate, ineligible and inconsistent data');
const db=await PGlite.create();const q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const a=await importPool(db,bytes(fixture()));assert.equal(a.total_players,5);assert.equal(a.sample.length,5);
  const retry=await importPool(db,bytes(fixture()));assert.equal(retry.import_id,a.import_id);assert.equal(retry.already_imported,true);
  const before=await q('select id from draft.players order by id');
  const changed=fixture();changed.players[0].player_name='Updated snapshot name';
  const b=await importPool(db,bytes(changed));assert.notEqual(b.import_id,a.import_id);
  assert.deepEqual(await q('select id from draft.players order by id'),before);
  assert.equal((await q('select name from draft.player_pool_entries where import_id=$1 and sport=\'NFL\'',[a.import_id]))[0].name,'Fixture NFL');
  assert.equal((await q('select name from draft.player_pool_entries where import_id=$1 and sport=\'NFL\'',[b.import_id]))[0].name,'Updated snapshot name');
  assert.equal((await q("select count(*)::int n from draft.player_source_ids where external_player_id='001'"))[0].n,5);
  console.log('PASS atomic import, exact-file retry, cross-league identities, stable IDs and new snapshot details');
  for(const sql of ["update draft.player_pool_imports set status='staging' where id=$1","delete from draft.player_pool_imports where id=$1","update draft.player_pool_entries set name='bad' where import_id=$1","delete from draft.player_pool_entries where import_id=$1","insert into draft.player_pool_entries select * from draft.player_pool_entries where import_id=$1"])
    await assert.rejects(()=>q(sql,[a.import_id]),/immutable|staging/);
  console.log('PASS finalized snapshot update, delete, insert and unfinalize blocked');
  const f=fixture();f.players[0].player_id='002';f.players[1].player_name='Rejected fixture';
  await db.exec("alter table draft.player_pool_entries add constraint injected_failure check(name<>'Rejected fixture')");
  await assert.rejects(()=>importPool(db,bytes(f)),/injected_failure/);
  assert.deepEqual(await q('select id from draft.players order by id'),before);
  assert.equal((await q('select count(*)::int n from draft.player_pool_imports'))[0].n,2);
  assert.equal((await q('select count(*)::int n from draft.drafts'))[0].n,0);
  console.log('PASS mid-import failure rolls back new players, source identities and snapshot; no draft created');
}finally{await db.close();}
