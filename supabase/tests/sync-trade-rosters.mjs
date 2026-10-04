// Scheduled importer; explicit project selection, verified TLS, no Auth accounts.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {ROSTER_FILES,validateRosters,syncConnection,syncRosters,SyncSettingsError} from './trade-roster-sync.mjs';
let db,stage='validating fresh roster files';
try{
  const mode=process.argv[2];
  if(!['--preview','--import'].includes(mode)||process.argv.length!==3)throw new Error('Use --preview or --import');
  const settings=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
  const files=await Promise.all(ROSTER_FILES.map(async([,file])=>JSON.parse(await readFile(new URL(`../../web/data/rosters/${file}.json`,import.meta.url),'utf8'))));
  const snapshots=validateRosters(settings,files);
  if(mode==='--preview')console.log(JSON.stringify({preview:true,sports:snapshots.map(s=>({sport:s.sport,players:s.count,observed_at:s.observed}))},null,2));
  else{
    stage='checking destination project settings';
    const config=syncConnection(process.env);
    stage='connecting with verified TLS';db=new pg.Client(config);await db.connect();
    stage='importing all five sports atomically';
    const result=await syncRosters(db,snapshots);
    console.log(JSON.stringify({project:process.env.TRADE_ROSTER_PROJECT_REF,...result},null,2));
  }
}catch(error){
  if(error instanceof SyncSettingsError)console.error('Setup issue: '+error.message);
  // Never print raw database errors, connection URIs, player records or secrets.
  const code=typeof error.code==='string'&&/^[A-Z0-9_]{1,45}$/.test(error.code)?error.code:'ERROR';
  console.error(`Trade roster sync failed while ${stage} (${code}). No partial five-sport import committed. Check fresh files, membership, target settings and TLS. A connection loss at commit requires a retry to confirm the outcome.`);
  process.exitCode=1;
}finally{if(db)await db.end().catch(()=>{});}
