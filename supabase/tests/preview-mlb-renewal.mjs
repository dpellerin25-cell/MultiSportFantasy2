// Read-only TEST-project preview. No activation flag is supported.
import pg from 'pg';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
let db;
try{
 assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
 assert.equal(process.argv.length,2,'This command only previews');
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));
 await db.connect();await db.query('begin read only');
 await db.query("set local statement_timeout='15s'");
 const result=await db.query('select trading.prepare_mlb_renewal(false) preview');
 console.log(JSON.stringify({project:PROJECT,preview_only:true,...result.rows[0].preview},null,2));
}catch{
 console.error('Preview failed. Check test-project settings, verified TLS and the renewal migration. No activation performed.');process.exitCode=1;
}finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
