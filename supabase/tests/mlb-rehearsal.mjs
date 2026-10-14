import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export class RehearsalSetupError extends Error {}
const requireSetup=(ok,message)=>{if(!ok)throw new RehearsalSetupError(message);};

// Caller owns a transaction and MUST roll it back, including on success.
export async function rehearseMLB(db,report=console.log){
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const scalar=async(s,p=[])=>Object.values((await q(s,p))[0])[0];
 const old='60ri2nbhmtj4b0km',next='rk8bvnk3mulovx9a';
 await q('select pg_advisory_xact_lock(731943,1)');
 await q('select pg_advisory_xact_lock(20260925,1)');
 const preview=await scalar('select trading.prepare_mlb_renewal(false)');
 requireSetup(preview.already_applied===undefined,'MLB renewal is already activated. This rehearsal requires an unapplied transition.');
 requireSetup(Array.isArray(preview.blockers)&&preview.blockers.length===0,'Renewal preview has blockers. Run preview-mlb-renewal.mjs and share its output.');
 requireSetup(preview.trade_players===0,'Existing MLB trade players were found. Use a separate disposable project; do not delete roster data to run this rehearsal.');
 // Avoid reconciling unrelated real offers, even temporarily.
 const active=Number(await scalar("select count(*) from trading.trades where status in('proposed','accepted')"));
 report(`Prerequisite check: active proposed/accepted trades = ${active}`);
 requireSetup(active===0,'Active proposals or accepted trades exist in this project. Use a separate disposable project; do not cancel or delete real trades just to run this test.');
 const owners=await q('select id,slug from draft.owners where active');
 const doug=owners.find(o=>o.slug==='doug'),chris=owners.find(o=>o.slug==='chris');
 requireSetup(doug&&chris,'Both Doug and Chris must be active league owners.');
 report('PASS rehearsal prerequisites; beginning temporary fixture checks');
 const historical=await q('select * from trading.roster_snapshots order by id');
 const sources=await q("select * from draft.player_source_ids where provider='fantrax' and league_id=$1 order by id",[old]);
 const poolCount=await scalar('select count(*) from draft.player_pool_entries');
 const ext='rehearsal-'+randomUUID();
 // Fixtures are synthetic and exist only inside this rolled-back transaction.
 const snap=await scalar("insert into trading.roster_snapshots(sport,league_id,observed_at,payload) values('MLB',$1,clock_timestamp(), '[]') returning id",[old]);
 const player=await scalar("insert into trading.players(sport,league_id,fantrax_id,name,owner_id,snapshot_id) values('MLB',$1,$2,'Disposable MLB rehearsal',$3,$4) returning id",[old,ext,doug.id,snap]);
 const trade=await scalar("insert into trading.trades(proposer_id,recipient_id,status,accepted_at) values($1,$2,'accepted',clock_timestamp()) returning id",[doug.id,chris.id]);
 await q('insert into trading.assets(trade_id,from_owner_id,to_owner_id,player_id) values($1,$2,$3,$4)',[trade,doug.id,chris.id,player]);
 await q('insert into trading.player_reservations values($1,$2)',[player,trade]);
 const activated=await scalar('select trading.prepare_mlb_renewal(true)');
 assert.equal(activated.applied,true);
 assert.equal((await scalar('select trading.prepare_mlb_renewal(true)')).already_applied,true);
 assert.equal(await scalar('select league_id from trading.players where id=$1',[player]),next);
 assert.equal(await scalar('select status from trading.trades where id=$1',[trade]),'accepted');
 assert.deepEqual(await q("select * from draft.player_source_ids where provider='fantrax' and league_id=$1 order by id",[old]),sources);
 assert.equal(Number(await scalar(`select count(*) from draft.player_source_ids old left join draft.player_source_ids new on new.provider=old.provider and new.external_player_id=old.external_player_id and new.league_id=$2 where old.provider='fantrax' and old.league_id=$1 and (new.player_id is distinct from old.player_id)`,[old,next])),0);
 assert.equal(await scalar('select count(*) from draft.player_pool_entries'),poolCount);
 assert.deepEqual(await q('select * from trading.roster_snapshots where id<>$1 order by id',[snap]),historical);
 report(`PASS rehearsal handoff/retry; ${sources.length} existing draft identities preserved; historical snapshots unchanged`);
 const roster=JSON.stringify(owners.map(o=>({owner:o.slug,players:o.id===chris.id?[{player_id:ext,name:'Disposable MLB rehearsal'}]:[]})));
 await q('savepoint retired_import');
 await assert.rejects(()=>q("select trading.ingest_rosters('MLB',$1,clock_timestamp(),$2)",[old,roster]),/Retired/);
 await q('rollback to savepoint retired_import');
 await q("select trading.ingest_rosters('MLB',$1,clock_timestamp(),$2)",[next,roster]);
 assert.equal(await scalar('select status from trading.trades where id=$1',[trade]),'completed');
 assert.equal(await scalar('select owner_id from trading.players where id=$1',[player]),chris.id);
 assert.equal(Number(await scalar('select count(*) from trading.player_reservations where player_id=$1',[player])),0);
 report('PASS retired connection rejected; synthetic new-season roster confirms pending trade with stable player identity');
 return {fixture_player:player,fixture_trade:trade,fixture_snapshot:snap};
}
