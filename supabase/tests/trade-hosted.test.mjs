// Opt-in TEST project only. All SQL fixtures roll back. No email worker invoked.
import pg from 'pg';
import {connectionConfig,signIn,PROJECT} from './hosted-validation.mjs';
import {validateHostedTrades,TradeSetupError} from './trade-hosted-validation.mjs';
let db,stage='checking settings';
try{
  const required=['DRAFT_TEST_CONFIRM','DRAFT_TEST_DATABASE_URL','DRAFT_TEST_PUBLISHABLE_KEY','DRAFT_TEST_DOUG_EMAIL','DRAFT_TEST_DOUG_PASSWORD','DRAFT_TEST_OWNER_EMAIL','DRAFT_TEST_OWNER_PASSWORD'];
  const missing=required.filter(k=>!process.env[k]);
  if(missing.length){console.error('Missing settings: '+missing.join(', '));throw new Error('Missing settings');}
  if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('Incorrect test confirmation');
  const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL),key=process.env.DRAFT_TEST_PUBLISHABLE_KEY;
  stage='verifying Doug sign-in';const doug=await signIn(key,process.env.DRAFT_TEST_DOUG_EMAIL,process.env.DRAFT_TEST_DOUG_PASSWORD);
  stage='verifying Chris sign-in';const chris=await signIn(key,process.env.DRAFT_TEST_OWNER_EMAIL,process.env.DRAFT_TEST_OWNER_PASSWORD);
  console.log('PASS real Auth sign-in and confirmed account verification');
  stage='connecting with verified TLS';db=new pg.Client(config);await db.connect();
  stage='opening rollback-only validation';await db.query('begin');
  await db.query("set local statement_timeout='15s';set local lock_timeout='5s';set local idle_in_transaction_session_timeout='60s'");
  stage='checking trade migration, unused schema, Doug/Chris links and a third linked owner';
  await validateHostedTrades(db,doug,chris,message=>{console.log(message);stage='checks following '+message;});
  stage='rolling back';await db.query('rollback');
  console.log('PASS hosted trade validation: all test rows rolled back; no picks or notifications committed.');
  console.log('Scope: real Auth sign-in plus SQL role authorization. HTTP trade RPC and email delivery are NOT tested. Auth sessions may remain until expiry.');
}catch(e){if(e instanceof TradeSetupError)console.error('Setup issue: '+e.message);const code=String(e.code??e.name??'Error');console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]{1,64}$/.test(code)?code:'Error'}). No test trade changes committed.`);process.exitCode=1;}
finally{if(db){try{await db.query('rollback');}catch{}await db.end();}}
