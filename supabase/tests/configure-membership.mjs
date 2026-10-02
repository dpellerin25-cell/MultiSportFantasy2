// TEST-project commissioner tooling. Never targets production.
import pg from 'pg';
import {readFile,writeFile} from 'node:fs/promises';
import {PROJECT,connectionConfig,signIn} from './hosted-validation.mjs';
let db,stage='arguments';
try {
 const [mode,file,...extra]=process.argv.slice(2);
 if(!['--preview','--apply'].includes(mode)||!file||extra.length)throw Error('Use --preview or --apply CONFIG.json');
 const c=JSON.parse(await readFile(file,'utf8'));
 if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw Error('Test project confirmation required');
 stage='commissioner sign-in';
 const user=await signIn(process.env.DRAFT_TEST_PUBLISHABLE_KEY,process.env.DRAFT_TEST_DOUG_EMAIL,process.env.DRAFT_TEST_DOUG_PASSWORD);
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
 stage='membership validation';await db.query('begin');
 await db.query('select draft.configure_membership($1,$2,$3,$4)',[c.championship_year,JSON.stringify(c.owners),c.placement_points,user]);
 const settings=(await db.query('select * from draft.season_settings where championship_year=$1',[c.championship_year])).rows[0];
 const owners=(await db.query('select slug,display_name name from draft.owners where active order by slug')).rows;
 await db.query(mode==='--apply'?'commit':'rollback');
 console.log(JSON.stringify({applied:mode==='--apply',project:PROJECT,owner_count:owners.length,startup_picks:65*owners.length,rookie_picks_per_year:10*owners.length,settings:{championship_year:c.championship_year,owners,placement_points:settings.placement_points.map(Number)}},null,2));
 if(mode==='--apply'){
   stage='saving approved website configuration (database already committed)';
   await writeFile(new URL('../../web/data/league-settings.json',import.meta.url),JSON.stringify({championship_year:c.championship_year,owners,placement_points:settings.placement_points.map(Number)},null,2)+'\n');
   console.log('Saved web/data/league-settings.json. Review and transfer this file with matching refreshed Fantrax data before publishing. Existing history is unchanged.');
 }
} catch(e){
 if(db)try{await db.query('rollback');}catch{}
 console.error(`Failed during ${stage}: ${e.code??e.name}. Review configuration and prerequisites; do not publish mismatched files.`);
 if(e.code==='P0001')console.error(e.message);
 process.exitCode=1;
} finally {if(db)await db.end();}
