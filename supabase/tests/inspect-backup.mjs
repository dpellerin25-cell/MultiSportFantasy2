import {readFile} from 'node:fs/promises';
import {decryptBundle,keyFrom} from './backup-core.mjs';
try{
 if(process.argv.length!==3)throw Error('One file required');
 const file=await readFile(process.argv[2]);
 const b=decryptBundle(file,keyFrom(process.env.BACKUP_ENCRYPTION_KEY));
 console.log(JSON.stringify({authenticated:true,project:b.project,created_at:b.created_at,server_version:b.server_version,
  encrypted_bytes:file.length,dump_bytes:Buffer.from(b.dump,'base64').length,schemas:b.schemas,extensions:b.extensions,
  tables:b.inventory.map(t=>({schema:t.schemaname,table:t.tablename,rows:t.count})),checkpoints:b.checkpoints.length,exclusions:b.exclusions},null,2));
}catch{console.error('Cannot authenticate/inspect backup. Check the file and original encryption key; no database was contacted.');process.exitCode=1;}
