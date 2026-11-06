import pg from 'pg';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {createCheckpointRehearsal,checkpointStatus} from './backup-rehearsal.mjs';
let db;
try{
 const [mode,...extra]=process.argv.slice(2);
 if(extra.length||!['--create','--status'].includes(mode))throw Error('Use --create or --status');
 if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw Error('Project confirmation required');
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
 if(mode==='--status'){await db.query('begin read only');console.log(JSON.stringify(await checkpointStatus(db),null,2));await db.query('rollback');}
 else console.log(JSON.stringify(await createCheckpointRehearsal(db),null,2));
}catch{console.error('Checkpoint rehearsal failed. Check explicit project settings, TLS and backup migration. After uncertain connection loss run --status; repeat --create safely. No real draft is targeted.');process.exitCode=1;}
finally{if(db)await db.end();}
