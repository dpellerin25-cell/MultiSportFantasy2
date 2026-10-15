import assert from 'node:assert/strict';
import {checksum} from './yearly-renewal.mjs';
import {assertPoolConnections} from './player-pool-import.mjs';
export const OLD='60ri2nbhmtj4b0km',NEXT='rk8bvnk3mulovx9a';
export const scenarioNames=['renewal-first','roster-first','two-renewals','pool-source-first'];

export async function mlbRaceScenario(name,{admin,race,generic=false}){
 const q=async(s,p=[])=>(await admin.query(s,p)).rows;
 const scalar=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
 const owners=await q('select id,slug from draft.owners where active');
 const doug=owners.find(o=>o.slug==='doug').id,chris=owners.find(o=>o.slug==='chris').id;
 const roster=owner=>JSON.stringify(owners.map(o=>({owner:o.slug,players:o.id===owner?[{player_id:'001',name:'Fixture MLB'}]:[]})));
 await q("select trading.ingest_rosters('MLB',$1,clock_timestamp()-interval '2 days',$2)",[OLD,roster(doug)]);
 const player=(await q('select * from trading.players'))[0];
 const snapshot=(await q('select * from trading.roster_snapshots'))[0];
 const draftPlayer=await scalar("insert into draft.players(sport,name) values('MLB','Fixture MLB') returning id");
 await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'fantrax',$2,'001')",[draftPlayer,OLD]);
 const trade=await scalar("insert into trading.trades(proposer_id,recipient_id,status,accepted_at) values($1,$2,'accepted',clock_timestamp()-interval '1 day') returning id",[doug,chris]);
 await q('insert into trading.assets(trade_id,from_owner_id,to_owner_id,player_id) values($1,$2,$3,$4)',[trade,doug,chris,player.id]);
 await q('insert into trading.player_reservations values($1,$2)',[player.id,trade]);
 let plan={sport:'MLB',old_league_id:OLD,new_league_id:NEXT,history_id:'ml3fdlq2mulovxoh',season_year:2027,
   started_at:new Date(Date.now()-1000).toISOString(),completed_at:new Date().toISOString(),
   players:[{player_id:'001',player_name:'Fixture MLB'},{player_id:'002',player_name:'Fixture MLB'}],rosters:JSON.parse(roster(doug))};
 const handoff=c=>(generic?c.query('select trading.apply_fantrax_renewal($1,$2) result',[JSON.stringify(plan),checksum(plan)]):c.query('select trading.prepare_mlb_renewal(true) result')).then(r=>r.rows[0].result);
 const ingest=(c,league)=>c.query("select trading.ingest_rosters('MLB',$1,clock_timestamp(),$2)",[league,roster(chris)]);
 if(name==='renewal-first'){
   const r=await race(handoff,c=>ingest(c,OLD));
   assert.match(r.second.error?.message??'',/Retired league/);
   assert.equal(await scalar('select status from trading.trades where id=$1',[trade]),'accepted');
   assert.equal(Number(await scalar('select count(*) from trading.roster_snapshots')),generic?2:1);
 }else if(name==='roster-first'){
   const r=await race(c=>ingest(c,OLD),handoff);
   if(generic){
     assert.match(r.second.error?.message??'',/Unexpected roster ownership/);
     assert.equal(Number(await scalar('select count(*) from trading.league_renewals')),0);
     plan={...plan,rosters:JSON.parse(roster(chris)),started_at:new Date().toISOString(),completed_at:new Date().toISOString()};
     await handoff(admin);
   }else assert.ifError(r.second.error);
   assert.equal(await scalar('select status from trading.trades where id=$1',[trade]),'completed');
   assert.equal(await scalar('select owner_id from trading.players where id=$1',[player.id]),chris);
 }else if(name==='two-renewals'){
   const r=await race(handoff,handoff);
   assert.ifError(r.second.error);assert.equal(r.first.applied,true);assert.equal(r.second.value.already_applied,true);
 }else if(name==='retired-pool-after-renewal'){
   assert.equal(generic,true);
   const r=await race(handoff,async c=>{
     await c.query('select pg_advisory_xact_lock(20260925,1)');
     await assertPoolConnections(async(s,p=[])=>(await c.query(s,p)).rows);
   });
   assert.match(r.second.error?.message??'',/Retired player-pool/);
 }else if(name==='pool-source-first'){
   // Exercise the source importer lock and identity write, not a live pool fetch.
   const r=await race(async c=>{
     await c.query('select pg_advisory_xact_lock(20260925,1)');
     await c.query("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'fantrax',$2,'002')",[draftPlayer,OLD]);
   },handoff);
   assert.ifError(r.second.error);
   assert.equal(await scalar("select player_id from draft.player_source_ids where league_id=$1 and external_player_id='002'",[NEXT]),draftPlayer);
 }else throw Error('Unknown scenario');
 assert.equal(Number(await scalar('select count(*) from trading.league_renewals')),1);
 assert.deepEqual((await q('select * from trading.roster_snapshots where id=$1',[snapshot.id]))[0],snapshot);
 assert.equal(await scalar('select league_id from trading.players where id=$1',[player.id]),NEXT);
 assert.equal(await scalar("select player_id from draft.player_source_ids where league_id=$1 and external_player_id='001'",[NEXT]),draftPlayer);
 assert.equal(Number(await scalar('select count(*) from draft.players')),1);
 assert.equal((await handoff(admin)).already_applied,true);
 await ingest(admin,NEXT);
 assert.equal(await scalar('select status from trading.trades where id=$1',[trade]),'completed');
 assert.equal(await scalar('select owner_id from trading.players where id=$1',[player.id]),chris);
 assert.equal(Number(await scalar('select count(*) from trading.player_reservations')),0);
}
