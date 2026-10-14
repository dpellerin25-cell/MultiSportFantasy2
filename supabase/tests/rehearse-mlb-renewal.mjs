import pg from 'pg';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {rehearseMLB} from './mlb-rehearsal.mjs';
let db,started=false;
try{
 assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
 assert.equal(process.argv.length,2,'No arguments supported');
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));
 await db.connect();await db.query('begin');started=true;
 await db.query("set local statement_timeout='60s'");
 await db.query("set local lock_timeout='10s'");
 await db.query("set local idle_in_transaction_session_timeout='60s'");
 const fixture=await rehearseMLB(db);
 await db.query('rollback');started=false;
 const check=await db.query(`select exists(select 1 from trading.players where id=$1) or exists(select 1 from trading.trades where id=$2) or exists(select 1 from trading.roster_snapshots where id=$3) remaining`,[fixture.fixture_player,fixture.fixture_trade,fixture.fixture_snapshot]);
 assert.equal(check.rows[0].remaining,false);
 console.log('PASS test-project rehearsal rolled back; fixture rows absent. No connection activation committed.');
 console.log('Scope: SQL handoff and synthetic roster confirmation only. Fresh Fantrax capture, HTTP/Auth and concurrent sessions are NOT tested.');
}catch(error){
 console.error(`FAIL rehearsal (${typeof error.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'check prerequisites'}). No commit is issued by this runner.`);
 process.exitCode=1;
}finally{
 if(db){if(started)await db.query('rollback').catch(()=>console.error('Rollback could not be acknowledged; connection will be closed.'));await db.end();}
}
