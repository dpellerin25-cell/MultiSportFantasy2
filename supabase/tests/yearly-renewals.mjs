import pg from 'pg';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {runtimeRegistry,previewRenewal,applyRenewal,automaticAllowed,SPORTS} from './yearly-renewal.mjs';
let db,stage='checking explicit project settings';
try{
 const [mode,path,...extra]=process.argv.slice(2);
 assert.ok(['export','preview','audit','apply','automatic'].includes(mode)&&path&&!extra.length);
 // The export destination does not exist yet: do not import it as input.
 if(mode==='export')delete process.env.FANTRAX_CONNECTIONS_FILE;
 const {syncConnection}=await import('./trade-roster-sync.mjs');
 assert.ok(process.env.FANTRAX_RENEWAL_CONFIRM&&process.env.FANTRAX_RENEWAL_CONFIRM===process.env.TRADE_ROSTER_PROJECT_REF);
 const baseline=JSON.parse(await readFile(new URL('../../scripts/fantrax-connections.json',import.meta.url),'utf8'));
 const settings=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
 const policy=JSON.parse(await readFile(new URL('../../scripts/fantrax-renewal-policy.json',import.meta.url),'utf8'));
 db=new pg.Client(syncConnection(process.env));stage='connecting with verified TLS';await db.connect();
 stage='reading approved database connections';
 await db.query('begin isolation level repeatable read read only');
 const registry=await runtimeRegistry(db,baseline);await db.query('rollback');
 if(mode==='export'){
   const root=fileURLToPath(new URL('../../',import.meta.url)),dest=resolve(path),rel=relative(root,dest);
   assert.ok(rel.startsWith('..')||isAbsolute(rel),'Runtime export must be outside repository');
   await writeFile(dest+'.tmp',JSON.stringify(registry,null,2));await rename(dest+'.tmp',dest);
   console.log('Exported runtime connections; no database changes.');
 }else if(mode==='automatic'){
   let failed=false;
   for(const sport of SPORTS){
     const file=resolve(path,`${sport}-capture.json`);let capture;
     try{capture=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
     if(!automaticAllowed(capture,policy))continue;
     stage=`automatic ${sport} validation and handoff`;
     try{console.log(JSON.stringify(await applyRenewal(db,capture,baseline,settings,policy,{automatic:true})));}
     catch{console.error(`${sport}: automatic handoff blocked; run preview for this capture. Current transaction rolled back.`);failed=true;}
   }
   // Optional pre-approved archive releases. Approval hashes bind the archived
   // bytes and exact old/new pair; initial setup exceptions are never automatic.
   for(const sport of SPORTS){
     const release=policy.sports[sport].standings_release;
     if(!release)continue;
     assert.ok(Number.isInteger(release.archive_year)&&/^[a-f0-9]{64}$/.test(release.approval_hash));
     const state=(await db.query('select league_id,standings_league_id from trading.fantrax_state where sport=$1',[sport])).rows[0];
     if(!state||state.league_id===state.standings_league_id)continue;
     const child=spawnSync(process.execPath,[fileURLToPath(new URL('./release-renewed-standings.mjs',import.meta.url)),'apply',sport,String(release.archive_year)],
       {stdio:'inherit',timeout:60000,env:{...process.env,FANTRAX_RENEWAL_APPROVE:release.approval_hash}});
     if(child.error||child.status!==0)failed=true;
   }
   if(failed)process.exitCode=1;
 }else{
   const capture=JSON.parse(await readFile(path,'utf8'));stage='validating capture and stored player identities';
   if(mode==='apply')console.log(JSON.stringify(await applyRenewal(db,capture,baseline,settings,policy,{approval:process.env.FANTRAX_RENEWAL_APPROVE}),null,2));
   else{await db.query('begin isolation level repeatable read read only');
     const report=await previewRenewal(db,capture,await runtimeRegistry(db,baseline),settings,policy,{auditOnly:mode==='audit'});
     await db.query('rollback');console.log(JSON.stringify(report,null,2));}
 }
}catch(e){console.error(`Renewal operation failed while ${stage} (${typeof e.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(e.code)?e.code:'check inputs/settings'}). No automatic fallback; retry a lost-connection apply with the identical capture.`);process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
