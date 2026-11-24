import pg from 'pg';
import {connectionConfig,PROJECT} from './hosted-validation.mjs';
import {auditPermissions} from './permissions-audit.mjs';
let db;
try{
  if(process.env.PRODUCTION_AUDIT_CONFIRM!==PROJECT)throw Error('confirmation');
  db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));
  await db.connect();
  await db.query('begin isolation level repeatable read read only');
  await db.query("set local statement_timeout='15s'; set local lock_timeout='5s'; set local idle_in_transaction_session_timeout='60s'");
  const report=await auditPermissions(db);
  await db.query('rollback');
  console.log(JSON.stringify(report,null,2));
}catch(e){
  const code=String(e.code??e.name??'ERROR');
  console.error(`Permissions audit failed (${/^[A-Za-z0-9_]{1,64}$/.test(code)?code:'ERROR'}). Check project settings, TLS, all 11 links and commissioner permissions. No changes requested; private details withheld.`);
  process.exitCode=1;
}finally{if(db){try{await db.query('rollback');}catch{}await db.end();}}
