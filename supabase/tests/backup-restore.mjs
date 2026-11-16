import assert from 'node:assert/strict';
import pg from 'pg';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {decryptBundle,keyFrom,inventory,identifier} from './backup-core.mjs';
import {command,pgEnvironment} from './backup-io.mjs';
export function restoreConfig(value,confirm){
 const u=new URL(value);
 assert.ok(['postgres:','postgresql:'].includes(u.protocol)&&u.hostname==='127.0.0.1'&&u.username==='postgres'&&u.password&&!u.search&&!u.hash);
 const database=u.pathname.slice(1);assert.match(database,/^pentagon_restore_[a-z0-9_]+$/);assert.equal(confirm,database);
 return {host:'127.0.0.1',port:Number(u.port),database,user:'postgres',password:decodeURIComponent(u.password),ssl:false};
}
export async function prepareEmptyRestore(db){
 const existing=(await db.query("select nspname from pg_namespace where nspname not in ('public','information_schema') and nspname not like 'pg_%'")).rows;
 assert.equal(existing.length,0,'Restore target must be empty');
 assert.equal((await db.query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'")).rows[0].n,0,'Restore target public schema must be empty');
 // A fresh PostgreSQL database includes public, but the archive creates it.
 // RESTRICT also refuses functions/types or other dependencies that the table
 // inventory does not see. Never use CASCADE or a broad pg_restore --clean.
 await db.query('drop schema if exists public restrict');
}
export async function ensureExtensionSchema(db,schema){
 // PostgreSQL rejects CREATE SCHEMA pg_catalog even with IF NOT EXISTS.
 // Reuse existing system namespaces; never try to recreate them.
 if((await db.query('select 1 from pg_namespace where nspname=$1',[schema])).rows.length)return;
 assert.ok(!schema.startsWith('pg_')&&schema!=='information_schema','Required system schema missing');
 await db.query(`create schema ${identifier(schema)}`);
}
export function verifyRestoreInventory(expected,actual){
 // Source and disposable databases can sort table names differently by locale.
 // Match identity, then require exactly the same count and content checksum.
 const key=t=>JSON.stringify([t.schemaname,t.tablename]);
 const wanted=new Map(expected.map(t=>[key(t),t])),found=new Map(actual.map(t=>[key(t),t]));
 assert.equal(wanted.size,expected.length,'Duplicate manifest tables');
 assert.equal(found.size,actual.length,'Duplicate restored tables');
 const differences=[];
 for(const id of new Set([...wanted.keys(),...found.keys()])){
  const e=wanted.get(id),a=found.get(id),t=e??a;
  if(!e||!a||String(e.count)!==String(a.count)||e.checksum!==a.checksum){
   differences.push({schema:t.schemaname,table:t.tablename,issue:!e?'unexpected_table':!a?'missing_table':String(e.count)!==String(a.count)?'row_count_mismatch':'content_mismatch',expected_rows:e?.count??null,actual_rows:a?.count??null});
  }
 }
 if(differences.length){const error=Error('Restored inventory differs');error.code='RESTORE_CONTENT_MISMATCH';error.safeDifferences=differences;throw error;}
}
export async function restoreDisposable(bundle,config,dir){
 const db=new pg.Client(config);await db.connect();
 try{
  await prepareEmptyRestore(db);
  // Rehearsal roles cannot log in. Hosted role passwords/config must be recreated separately.
  for(const role of bundle.roles){
   if(!(await db.query('select 1 from pg_roles where rolname=$1',[role.rolname])).rows.length)await db.query(`create role ${identifier(role.rolname)} nologin`);
  }
  for(const grant of bundle.memberships??[]){
   await db.query(`grant ${identifier(grant.role)} to ${identifier(grant.member)}${grant.admin_option?' with admin option':''}`);
  }
  for(const ext of bundle.extensions.filter(e=>e.extname!=='plpgsql')){
   await ensureExtensionSchema(db,ext.schema);
   const version=ext.extversion ? ` version '${ext.extversion.replaceAll("'","''")}'` : '';
   await db.query(`create extension if not exists ${identifier(ext.extname)} with schema ${identifier(ext.schema)}${version}`);
  }
  const dump=join(dir,'restore.dump');await writeFile(dump,Buffer.from(bundle.dump,'base64'),{mode:0o600});
  const env=await pgEnvironment(config,dir);
  await command('pg_restore',['--no-owner','--exit-on-error','--single-transaction','--dbname='+config.database,dump],env);
  await db.query("set timezone='UTC'");
  verifyRestoreInventory(bundle.inventory,await inventory(db));
  return {restored:true,verified_tables:bundle.inventory.length,rows:bundle.inventory.reduce((n,t)=>n+Number(t.count),0),checkpoint_count:bundle.checkpoints.length,
   scope:'Disposable database row counts and content hashes verified. Hosted Auth login, platform settings and role ownership require separate validation.'};
 }finally{await db.end();}
}
export async function restoreFile(file,env=process.env){
 const config=restoreConfig(env.BACKUP_RESTORE_DATABASE_URL,env.BACKUP_RESTORE_CONFIRM);
 const bundle=decryptBundle(await readFile(file),keyFrom(env.BACKUP_ENCRYPTION_KEY));
 const dir=await mkdtemp(join(tmpdir(),'pentagon-restore-'));
 try{return await restoreDisposable(bundle,config,dir);}finally{await rm(dir,{recursive:true,force:true});}
}
