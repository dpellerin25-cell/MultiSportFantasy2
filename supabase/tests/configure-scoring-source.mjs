import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {syncConnection} from './trade-roster-sync.mjs';
import {runtimeRegistry} from './yearly-renewal.mjs';
import {approveSource} from './scheduled-scoring.mjs';
let db;
try{
 const [mode,file,approval]=process.argv.slice(2);
 assert.ok(['--template','--preview','--apply','--publish','--unpublish','--disable'].includes(mode)&&file);
 if(mode==='--template'){
  await writeFile(file,JSON.stringify({version:1,sport:'MLB',league_id:'REPLACE',season_year:2027,is_test:false,start_date:'2027-03-24',end_date:'2027-09-26',lineup_attribution_verified:false,reason:'Verify and approve league metadata, counted historical lineups and team ownership',teams:[{owner:'Doug',team_id:'REPLACE_WITH_VERIFIED_ID'}],periods:[]},null,2),{flag:'wx'});
  console.log('Template only: replace every field using verified league metadata; include every active owner.');
 }else{
  assert.ok(process.env.SCORING_PROJECT_CONFIRM);assert.equal(process.env.SCORING_PROJECT_CONFIRM,process.env.TRADE_ROSTER_PROJECT_REF);
  db=new pg.Client(syncConnection(process.env));await db.connect();
  if(['--publish','--unpublish','--disable'].includes(mode)){
   assert.match(file,/^[0-9a-f-]{36}$/i);assert.ok(approval==='CONFIRM');
   const result=await db.query(`update scoring.sources src set ${mode==='--publish'?'publish=true':mode==='--unpublish'?'publish=false':'enabled=false'} from scoring.seasons s where src.id=$1 and src.season_id=s.id ${mode==='--publish'?'and not s.is_test':''} returning src.id`,[file]);
   assert.equal(result.rows.length,1);console.log('Source updated; standings unchanged.');
  }else{
   const spec=JSON.parse(await readFile(file,'utf8'));
   const baseline=JSON.parse(await readFile(new URL('../../scripts/fantrax-connections.json',import.meta.url),'utf8'));
   console.log(JSON.stringify(await approveSource(db,spec,{apply:mode==='--apply',approval,registry:await runtimeRegistry(db,baseline)}),null,2));
  }
 }
}catch{console.error('Scoring source operation rejected. Check verified metadata, full owner mappings, explicit project settings and preview approval. No automatic fallback.');process.exitCode=1;}
finally{if(db)await db.end();}

