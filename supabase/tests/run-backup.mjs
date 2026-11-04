import {runExport} from './backup-export.mjs';
try{console.log(JSON.stringify(await runExport(process.argv.slice(2)),null,2));}
catch{console.error('Backup failed. Check project confirmation, verified TLS, encryption key, PostgreSQL client version, migration and R2 credentials. No raw errors or credentials printed. Failed uploads remain pending.');process.exitCode=1;}
