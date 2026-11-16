// Local encrypted file only. No hosted URL, R2 access, or production credentials.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,chmod,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command} from './backup-io.mjs';
import {decryptBundle,keyFrom} from './backup-core.mjs';
import {restoreDisposable} from './backup-restore.mjs';
import {readyPostgres} from './backup-postgres-ready.mjs';
import {backupFailureCode} from './backup-errors.mjs';
import {RESTORE_IMAGE,bootstrap,checkCompatibility,VERIFIED_LEGACY_LOCALE,localeQuery,restoreDatabaseSql,verifyLocale} from './backup-real-guards.mjs';
let dir,container,admin,stage='authenticating local backup',created=false;
const oldPath=process.env.PATH;
const docker=args=>command('docker',args);
try{
 assert.equal(process.platform,'linux','Run in Linux Codespaces');
 assert.equal(process.argv.length,3,'One encrypted backup filename required');
 const bundle=decryptBundle(await readFile(process.argv[2]),keyFrom(process.env.BACKUP_ENCRYPTION_KEY));
 assert.equal(bundle.server_version.split('.')[0],'17');
 stage='pulling pinned Supabase PostgreSQL image';console.log('Checking '+stage);
 await docker(['pull',RESTORE_IMAGE]);
 dir=await mkdtemp(join(tmpdir(),'pentagon-real-restore-'));
 // Only the socket folder is shared. No source files, credentials or database files are mounted.
 const socket=join(dir,'socket');await mkdir(socket);await chmod(dir,0o711);await chmod(socket,0o777);
 container='pentagon-real-restore-'+randomBytes(6).toString('hex');
 const password=randomBytes(32).toString('hex');
 stage='starting network-isolated empty database';console.log('Checking '+stage);
 await command('docker',['create','--name',container,'--network','none','--user','postgres','--entrypoint','bash',
  '--mount',`type=bind,source=${socket},target=/restore-socket`,'-e','POSTGRES_PASSWORD',RESTORE_IMAGE,'-c',bootstrap],{...process.env,POSTGRES_PASSWORD:password});created=true;
 await docker(['start',container]);
 const config={host:socket,port:5432,user:'postgres',password,database:'postgres',ssl:false};
 admin=await readyPostgres(config);
 stage='checking PostgreSQL and exact extension versions';console.log('Checking '+stage);
 checkCompatibility(bundle,(await admin.query('show server_version')).rows[0].server_version,(await admin.query('select name,version from pg_available_extension_versions')).rows);
 assert.equal((await admin.query('show cron.launch_active_jobs')).rows[0]['cron.launch_active_jobs'],'off');
 stage='creating database with verified source locale';console.log('Checking '+stage);
 const sourceLocale=bundle.database_locale??VERIFIED_LEGACY_LOCALE;
 await admin.query(restoreDatabaseSql(sourceLocale));
 verifyLocale(sourceLocale,(await admin.query(localeQuery,['pentagon_restore_real'])).rows[0]);
 await admin.end();admin=null;
 // Stream the dump to the container utility; no plaintext copy remains in Docker.
 const wrapper=`#!/usr/bin/env node
const {spawnSync}=require('node:child_process'),{readFileSync}=require('node:fs');
const args=process.argv.slice(2),file=args.pop();
const env={...process.env,PGHOST:'/restore-socket',PGPORT:'5432'};
const r=spawnSync('docker',['exec','-i','-e','PGHOST','-e','PGPORT','-e','PGUSER','-e','PGPASSWORD',${JSON.stringify(container)},'pg_restore',...args],{env,input:readFileSync(file),timeout:1200000,maxBuffer:33554432});
if(r.status!==0){process.stderr.write('BACKUP_CODE:RESTORE_SQL_FAILED');process.exit(1);}
`;
 await writeFile(join(dir,'pg_restore'),wrapper,{mode:0o700});process.env.PATH=dir+':'+oldPath;
 stage='restoring and verifying all table content hashes';console.log('Checking '+stage);
 const result=await restoreDisposable(bundle,{...config,database:'pentagon_restore_real'},dir);
 console.log(JSON.stringify(result,null,2));
 console.log('PASS real encrypted backup restored and table contents verified. No hosted database, website, email service or R2 contacted.');
}catch(error){
 if(error.code==='RESTORE_CONTENT_MISMATCH')console.error(JSON.stringify({table_differences:error.safeDifferences},null,2));
 console.error(`FAIL real restore while ${stage} (${backupFailureCode(error)}). Raw errors withheld to protect account data. No live database targeted.`);process.exitCode=1;
}
finally{
 process.env.PATH=oldPath;
 if(admin)await admin.end().catch(()=>{});
 // Real Auth data must not remain in a running or retained fixture.
 let removed=!created;
 if(created){try{await docker(['rm','-fv',container]);removed=true;console.log('Disposable restore container and volumes removed.');}catch{process.exitCode=1;console.error('Cleanup required: docker rm -fv '+container);}}
 if(dir&&removed)await rm(dir,{recursive:true,force:true});
}
