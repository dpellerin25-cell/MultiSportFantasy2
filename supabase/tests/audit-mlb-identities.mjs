import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {auditMLB,validateManifest} from './mlb-identity-audit.mjs';
let db,stage='reading complete identity manifest';
try{
 assert.equal(process.argv.length,3,'Supply the identity manifest filename');
 const manifest=validateManifest(JSON.parse(await readFile(process.argv[2],'utf8')));
 stage='checking test-project settings';
 for(const key of ['DRAFT_TEST_CONFIRM','DRAFT_TEST_DATABASE_URL'])if(!process.env[key])throw Error('Missing settings');
 assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));
 stage='connecting with verified TLS';await db.connect();
 await db.query('begin isolation level repeatable read read only');
 await db.query("set local statement_timeout='60s'");
 stage='comparing identities and draft/trade references';
 const report=await auditMLB(db,manifest);await db.query('rollback');
 console.log(JSON.stringify({project:PROJECT,...report},null,2));
}catch(e){console.error(`Identity audit failed while ${stage} (${typeof e.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:'check input/settings'}). No database changes requested.`);process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
