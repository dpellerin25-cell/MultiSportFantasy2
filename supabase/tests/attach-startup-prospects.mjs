import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {attachProspects} from './startup-prospect-attachment.mjs';
import {prospectAttachmentIssue} from './prospect-attachment-errors.mjs';
let db;
try{
 const [mode,target,approval,bindingsFile]=process.argv.slice(2);
 if(!['--preview','--apply'].includes(mode)||!target||(mode==='--apply'&&!approval))throw Error('arguments');
 if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw Error('project');
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
 const bindings=bindingsFile?JSON.parse(await readFile(bindingsFile,'utf8')):{};
 console.log(JSON.stringify(await attachProspects(db,target,{approval:mode==='--apply'?approval:undefined,bindings}),null,2));
}catch(e){console.error('Setup issue: '+prospectAttachmentIssue(e));console.error('Prospect attachment failed; no partial attachment committed. After connection loss, preview again before retrying.');process.exitCode=1;}
finally{if(db)await db.end();}
