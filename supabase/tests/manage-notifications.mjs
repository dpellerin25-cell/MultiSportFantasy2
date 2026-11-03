import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {syncConnection} from './trade-roster-sync.mjs';
import {PROJECT,previewQueue,suppressionPlan} from './notification-admin.mjs';
let db,stage='checking settings';
try{
 const [mode,file,hash,...extra]=process.argv.slice(2);
 assert.ok(!extra.length&&((mode==='--preview'&&!file&&!hash)||(mode==='--plan'&&file&&!hash)||(mode==='--suppress'&&file&&hash)));
 assert.equal(process.env.TRADE_ROSTER_PROJECT_REF,PROJECT);
 assert.equal(process.env.NOTIFICATION_ADMIN_CONFIRM,PROJECT);
 const plan=file?JSON.parse(await readFile(file,'utf8')):null;
 db=new pg.Client(syncConnection(process.env));stage='connecting with verified TLS';await db.connect();
 stage=mode==='--suppress'?'applying approved suppression':'reading queue';
 console.log(JSON.stringify(mode==='--preview'?await previewQueue(db):await suppressionPlan(db,plan,{apply:mode==='--suppress',approval:hash}),null,2));
}catch{
 console.error(`Notification administration failed while ${stage}. Check settings, migration, selected IDs and fresh approval hash. After an uncertain commit retry the identical plan/hash. No email was sent.`);
 process.exitCode=1;
}finally{if(db)await db.end().catch(()=>{});}
