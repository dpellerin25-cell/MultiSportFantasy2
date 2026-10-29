import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {importScoring,ScoringImportError} from './scoring-import.mjs';
let db,stage='checking arguments';
try{
 const [mode,file,approval,...extra]=process.argv.slice(2);
 if(!['--preview','--import'].includes(mode)||!file||extra.length||(mode==='--import'?!/^[a-f0-9]{64}$/.test(approval??''):approval!==undefined))throw Error('Usage');
 stage='checking test-project settings';
 if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw Error('Confirmation');
 const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL);
 stage='reading saved test envelope';const envelope=JSON.parse(await readFile(file,'utf8'));
 stage='connecting with verified TLS';db=new pg.Client(config);await db.connect();
 stage='validating and importing test evidence';
 console.log(JSON.stringify(await importScoring(db,envelope,{apply:mode==='--import',approval}),null,2));
}catch(e){
 if(e instanceof ScoringImportError)console.error('Input issue: '+e.message);
 const code=String(e.code??e.name??'Error');
 console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No partial import requested; after connection loss retry the identical file and approval. Usage: node import-scoring.mjs --preview FILE | --import FILE APPROVAL_HASH`);process.exitCode=1;
}finally{if(db){try{await db.query('rollback');}catch{}try{await db.end();}catch{}}}
