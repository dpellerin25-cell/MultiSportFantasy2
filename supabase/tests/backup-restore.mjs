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
   await db.query(`create schema if not exists ${identifier(ext.schema)}`);
   await db.query(`create extension if not exists ${identifier(ext.extname)} with schema ${identifier(ext.schema)}`);
  }
  const dump=join(dir,'restore.dump');await writeFile(dump,Buffer.from(bundle.dump,'base64'),{mode:0o600});
  const env=await pgEnvironment(config,dir);
  await command('pg_restore',['--no-owner','--exit-on-error','--single-transaction','--dbname='+config.database,dump],env);
  await db.query("set timezone='UTC'");
  assert.deepEqual(await inventory(db),bundle.inventory,'Restored table contents differ');
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
