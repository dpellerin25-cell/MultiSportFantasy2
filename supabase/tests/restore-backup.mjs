import {restoreFile} from './backup-restore.mjs';
try{if(process.argv.length!==3)throw Error();console.log(JSON.stringify(await restoreFile(process.argv[2]),null,2));}
catch{console.error('Restore failed. Only an empty loopback disposable pentagon_restore_* database is allowed. Check key, archive integrity, PostgreSQL tools and required extensions. Raw errors withheld.');process.exitCode=1;}
