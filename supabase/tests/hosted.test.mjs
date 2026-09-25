import pg from 'pg';
import {connectionConfig,signIn,validateHostedCommands,PROJECT} from './hosted-validation.mjs';

let db;
let stage='checking required environment variables';
try {
  const required=['DRAFT_TEST_DATABASE_URL','DRAFT_TEST_CONFIRM','DRAFT_TEST_PUBLISHABLE_KEY','DRAFT_TEST_DOUG_EMAIL','DRAFT_TEST_DOUG_PASSWORD','DRAFT_TEST_OWNER_EMAIL','DRAFT_TEST_OWNER_PASSWORD'];
  const missing=required.filter(name=>!process.env[name]);
  if(missing.length){console.error('Missing settings: '+missing.join(', '));throw new Error('Missing settings');}
  stage='validating the test database URL (test project, port 5432, database postgres, no query parameters)';
  const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL);
  stage='checking DRAFT_TEST_CONFIRM matches the test project reference';
  if(process.env.DRAFT_TEST_CONFIRM!==PROJECT) throw new Error('Set DRAFT_TEST_CONFIRM to the test project reference.');
  const key=process.env.DRAFT_TEST_PUBLISHABLE_KEY;
  stage='signing in and verifying Doug test account';
  const doug=await signIn(key,process.env.DRAFT_TEST_DOUG_EMAIL,process.env.DRAFT_TEST_DOUG_PASSWORD);
  stage='signing in and verifying other owner test account';
  const other=await signIn(key,process.env.DRAFT_TEST_OWNER_EMAIL,process.env.DRAFT_TEST_OWNER_PASSWORD);
  stage='connecting to the test database with verified TLS';
  db=new pg.Client(config); await db.connect();
  stage='opening the rollback-only test transaction';
  await db.query('begin');
  await db.query("set local statement_timeout='15s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='60s'");
  stage='checking database fixtures and permissions';
  await validateHostedCommands(db,doug,other,message=>{console.log(message);stage='database checks following: '+message;});
  stage='rolling back test data';
  await db.query('rollback');
  console.log('PASS hosted database role checks; all fixture rows and temporary grants rolled back. Auth sign-in sessions may remain until expiry.');
  console.log('This checks real Auth sign-in plus SQL role authorization, not the HTTP draft RPC or Realtime.');
} catch(error) {
  // Never dump connection strings, server response bodies, passwords or tokens.
  const code=String(error.code??error.name??'error');
  const safeCode=/^[A-Za-z0-9_]{1,64}$/.test(code)?code:'error';
  console.error(`FAIL during ${stage} (${safeCode}). No draft changes are committed.`);
  process.exitCode=1;
} finally {
  if(db){try{await db.query('rollback');}catch{}await db.end();}
}
