import pg from 'pg';
import {connectionConfig,signIn,validateHostedCommands,PROJECT} from './hosted-validation.mjs';

let db;
try {
  const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL);
  if(process.env.DRAFT_TEST_CONFIRM!==PROJECT) throw new Error('Set DRAFT_TEST_CONFIRM to the test project reference.');
  const key=process.env.DRAFT_TEST_PUBLISHABLE_KEY;
  const doug=await signIn(key,process.env.DRAFT_TEST_DOUG_EMAIL,process.env.DRAFT_TEST_DOUG_PASSWORD);
  const other=await signIn(key,process.env.DRAFT_TEST_OWNER_EMAIL,process.env.DRAFT_TEST_OWNER_PASSWORD);
  db=new pg.Client(config); await db.connect();
  await db.query('begin');
  await db.query("set local statement_timeout='15s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='60s'");
  await validateHostedCommands(db,doug,other);
  await db.query('rollback');
  console.log('PASS hosted database role checks; all fixture rows and temporary grants rolled back. Auth sign-in sessions may remain until expiry.');
  console.log('This checks real Auth sign-in plus SQL role authorization, not the HTTP draft RPC or Realtime.');
} catch(error) {
  // Never dump connection strings, server response bodies, passwords or tokens.
  console.error(`FAIL hosted validation (${error.code??error.name??'error'}). Check test credentials, migrations and documented prerequisites. No draft changes are committed.`);
  process.exitCode=1;
} finally {
  if(db){try{await db.query('rollback');}catch{}await db.end();}
}
