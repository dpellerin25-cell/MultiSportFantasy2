import pg from 'pg';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
const [mode,id,approval]=process.argv.slice(2);
let db;
try {
 assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
 assert.ok(['--list','--preview','--apply'].includes(mode));
 if(mode!=='--list')assert.match(id??'',/^[a-f0-9-]{36}$/i);
 if(mode==='--apply')assert.match(approval??'',/^[a-f0-9]{32}$/);
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
 await db.query(mode==='--apply'?'begin':'begin read only');
 await db.query("set local lock_timeout='15s';set local statement_timeout='30s'");
 const result=mode==='--list'?(await db.query("select id,name,status,rounds,participant_count,revision from draft.drafts where kind='startup' order by id")).rows:
 (await db.query(mode==='--preview'?'select draft.preview_startup_transition($1) result':'select draft.apply_startup_transition($1,$2) result',mode==='--preview'?[id]:[id,approval])).rows[0].result;
 await db.query(mode==='--apply'?'commit':'rollback');console.log(JSON.stringify(result,null,2));
}catch{console.error('Transition failed. Check test-project settings, migrations and current preview. Retry with identical approval after uncertain connection loss.');process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
