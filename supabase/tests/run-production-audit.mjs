import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {connectionConfig,PROJECT} from './hosted-validation.mjs';
import {collectAudit,assessAudit} from './production-audit.mjs';
let db;
try {
 if(process.argv.length!==2||process.env.PRODUCTION_AUDIT_CONFIRM!==PROJECT)throw Error();
 const config=connectionConfig(process.env.DRAFT_TEST_DATABASE_URL);
 // Default read-only from connection establishment, plus an explicit read-only transaction.
 db=new pg.Client({...config,options:'-c default_transaction_read_only=on',application_name:'pentagon-read-only-audit'});
 await db.connect();
 const expected=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
 const versions=(await readdir(new URL('../migrations/',import.meta.url))).filter(x=>x.endsWith('.sql')).map(x=>x.split('_')[0]).sort();
 const report=assessAudit(await collectAudit(db),expected,versions);
 console.log(JSON.stringify({project:PROJECT,generated_at:new Date().toISOString(),...report},null,2));
 if(report.findings.some(x=>x.status!=='verified'))process.exitCode=2;
}catch{console.error('Audit could not complete. Check PRODUCTION_AUDIT_CONFIRM, DRAFT_TEST_DATABASE_URL, verified TLS and database access. No changes requested; raw errors withheld.');process.exitCode=1;}
finally{if(db)await db.end().catch(()=>{});}
