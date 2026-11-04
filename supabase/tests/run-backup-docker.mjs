// No hosted credentials, network requests to Supabase/R2, or source mounts.
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,readFile,readdir,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import assert from 'node:assert/strict';
import {exportDatabase} from './backup-export.mjs';
import {restoreDisposable} from './backup-restore.mjs';
import {encryptBundle,decryptBundle} from './backup-core.mjs';
import {backupFailureCode} from './backup-errors.mjs';
import {readyPostgres} from './backup-postgres-ready.mjs';
const docker=(args,env=process.env)=>{
 const r=spawnSync('docker',args,{env,encoding:'utf8',timeout:300000,windowsHide:true});
 if(r.error||r.status!==0){const error=Error('Docker operation failed');error.code=backupFailureCode(r.error??r);throw error;}return r.stdout.trim();
};
let container,dir,source,stage='checking Docker/Linux';
const step=value=>{stage=value;console.log('Checking '+value);};
try{
 assert.notEqual(process.platform,'win32','Run this disposable test in Linux Codespaces');
 docker(['info']);dir=await mkdtemp(join(tmpdir(),'pentagon-backup-test-'));
 container='pentagon-backup-test-'+randomBytes(5).toString('hex');
 const password=randomBytes(24).toString('hex');
 docker(['run','-d','--name',container,'-e','POSTGRES_PASSWORD','-p','127.0.0.1::5432','postgres:17-alpine'],{...process.env,POSTGRES_PASSWORD:password});
 console.log('Disposable container: '+container);
 step('PostgreSQL startup');
 const port=JSON.parse(docker(['inspect',container]))[0].NetworkSettings.Ports['5432/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');
 const base={host:'127.0.0.1',port:Number(port.HostPort),user:'postgres',password,ssl:false};
 const admin=await readyPostgres({...base,database:'postgres'});
 step('creating empty source and restore databases');
 try{await admin.query('create database pentagon_backup_source');await admin.query('create database pentagon_restore_test');}
 finally{await admin.end();}
 // Use the container's version-matched pg_dump/pg_restore via isolated wrappers.
 step('preparing PostgreSQL tool wrappers');
 for(const tool of ['pg_dump','pg_restore']){
  const path=join(dir,tool);
  const script=`#!/usr/bin/env node
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2),container=${JSON.stringify(container)},tool=${JSON.stringify(tool)};
const env={...process.env,PGHOST:'127.0.0.1',PGPORT:'5432'};
async function run(a){const r=spawnSync('docker',a,{env,encoding:'utf8',timeout:120000});if(r.status!==0){const {backupFailureCode}=await import(${JSON.stringify(new URL('./backup-errors.mjs',import.meta.url).href)});process.stderr.write('BACKUP_CODE:'+backupFailureCode(r.error??r));process.exit(1);}}
async function main(){
let file;
if(tool==='pg_dump'){const i=args.findIndex(x=>x.startsWith('--file='));file=args[i].slice(7);args[i]='--file=/tmp/test.dump';}
else{file=args.at(-1);await run(['cp',file,container+':/tmp/restore.dump']);args[args.length-1]='/tmp/restore.dump';}
await run(['exec','-e','PGHOST','-e','PGPORT','-e','PGUSER','-e','PGPASSWORD','-e','PGDATABASE',container,tool,...args]);
if(tool==='pg_dump')await run(['cp',container+':/tmp/test.dump',file]);
}
main().catch(()=>{process.stderr.write('BACKUP_CODE:UNCLASSIFIED');process.exit(1);});
`;
  await writeFile(path,script);await chmod(path,0o700);
 }
 process.env.PATH=dir+':'+process.env.PATH;
 const sourceConfig={...base,database:'pentagon_backup_source'};
 source=new pg.Client(sourceConfig);await source.connect();
 await source.query(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const migrations=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()){stage='applying fixture migration '+f;await source.query(await readFile(new URL(f,migrations),'utf8'));}
 step('seeding synthetic account and picks');
 const user=randomUUID();await source.query('insert into auth.users values($1,$2,now())',[user,'private-fixture@example.invalid']);
 await source.query("insert into draft.owner_accounts select $1,id from draft.owners where slug='doug'",[user]);
 await source.query("insert into draft.league_roles values($1,'commissioner')",[user]);
 await source.query('select trading.import_pick_ledger($1)',[JSON.stringify({version:1,trades:[]})]);
 step('exporting consistent PostgreSQL snapshot');
 const snapshot=await exportDatabase(source,sourceConfig,dir),key=randomBytes(32);
 step('encrypting and decrypting export');
 const encrypted=encryptBundle(snapshot,key),restored=decryptBundle(encrypted,key);
 // Prove later source writes are excluded from this recovery point.
 await source.query("update auth.users set email='later-change@example.invalid' where id=$1",[user]);
 step('restoring export and comparing table contents');
 console.log(JSON.stringify(await restoreDisposable(restored,{...base,database:'pentagon_restore_test'},dir)));
 step('checking nonempty-target refusal and restored permissions');
 await assert.rejects(()=>restoreDisposable(restored,{...base,database:'pentagon_restore_test'},dir));
 const target=new pg.Client({...base,database:'pentagon_restore_test'});await target.connect();
 assert.equal((await target.query('select email from auth.users where id=$1',[user])).rows[0].email,'private-fixture@example.invalid');
 await target.query('set role anon');await assert.rejects(()=>target.query('select * from backup.receipts'));await target.query('reset role');await target.end();
 console.log(JSON.stringify({synthetic_encrypted_bytes:encrypted.length,synthetic_dump_bytes:Buffer.from(snapshot.dump,'base64').length}));
 console.log('PASS actual pg_dump snapshot, encryption/decryption, pg_restore, full table hashes, Auth-link preservation, private permissions and nonempty-target rejection. Synthetic data only; no hosted service contacted.');
}catch(error){console.error(`FAIL disposable backup rehearsal while ${stage} (${backupFailureCode(error)}). Hosted services were not contacted; raw errors withheld.`);process.exitCode=1;}
finally{
 if(source)await source.end().catch(()=>{});
 if(dir)await rm(dir,{recursive:true,force:true});
 if(container)console.log(`Fixture container retained. Remove when finished: docker rm -fv ${container}`);
}
