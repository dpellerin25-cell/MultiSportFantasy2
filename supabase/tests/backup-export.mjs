import pg from 'pg';
import {mkdtemp,rm,writeFile,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {syncConnection} from './trade-roster-sync.mjs';
import {PROJECT,SCHEMAS,inventory,encryptBundle,keyFrom,sha,objectKey} from './backup-core.mjs';
import {command,pgEnvironment,r2Settings,uploadVerified} from './backup-io.mjs';

export async function exportDatabase(db,config,dir){
 await db.query('begin isolation level repeatable read read only');
 try{
  await db.query("set local statement_timeout='10min'");
  await db.query("set local timezone='UTC'");
  const snapshot=(await db.query('select pg_export_snapshot() snapshot')).rows[0].snapshot;
  const counts=await inventory(db);
  for(const name of ['draft','trading','scoring','auth'])assert.ok(counts.some(t=>t.schemaname===name),'Required schema absent');
  const roles=(await db.query("select rolname,rolcanlogin,rolinherit,rolbypassrls from pg_roles where rolname not like 'pg_%' order by rolname")).rows;
  const memberships=(await db.query('select r.rolname role,m.rolname member,a.admin_option from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member order by 1,2')).rows;
  const extensions=(await db.query('select e.extname,n.nspname schema,e.extversion from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname')).rows;
  const drafts=(await db.query('select id,status,revision from draft.drafts order by id')).rows;
  const checkpoints=(await db.query('select c.* from backup.draft_checkpoints c where not exists(select 1 from backup.receipts r where r.checkpoint_id=c.id) order by c.created_at,c.id')).rows;
  const databaseBytes=(await db.query('select pg_database_size(current_database())::text bytes')).rows[0].bytes;
  const serverVersion=(await db.query('show server_version')).rows[0].server_version;
  const dump=join(dir,'database.dump'),env=await pgEnvironment(config,dir);
  // One exported MVCC snapshot is shared by hashes, checkpoints and pg_dump.
  await command('pg_dump',['--format=custom','--compress=6','--no-owner','--snapshot='+snapshot,'--file='+dump,...SCHEMAS.map(s=>'--schema='+s)],env);
  assert.ok((await stat(dump)).size<512*1024*1024,'Dump exceeds 512 MiB safety budget; review exporter memory limits');
  const bytes=await readFile(dump);
  const bundle={version:1,project:PROJECT,created_at:new Date().toISOString(),database_bytes:databaseBytes,server_version:serverVersion,
   schemas:SCHEMAS,inventory:counts,roles,memberships,extensions,drafts,checkpoints,dump_sha256:sha(bytes),dump:bytes.toString('base64'),
   exclusions:['Storage object bytes','Platform/Auth/SMTP settings and API secrets','Role passwords','Database schemas outside the explicit allowlist','Cron configuration outside these schemas']};
  await db.query('commit');return bundle;
 }catch(e){await db.query('rollback');throw e;}
}

export async function runExport(args,env=process.env){
 const [mode,output,...extra]=args;
 assert.ok(!extra.length&&['--preview','--daily','--manual','--drafts','--local'].includes(mode));
 assert.equal(!!output,mode==='--local','Only --local accepts an output file');
 assert.equal(env.BACKUP_PROJECT_CONFIRM,PROJECT);assert.equal(env.TRADE_ROSTER_PROJECT_REF,PROJECT);
 const config=syncConnection(env),db=new pg.Client(config);
 let dir;
 try{
  await db.connect();await db.query("set application_name='pentagon-backup'");
  const locked=(await db.query('select pg_try_advisory_lock(731947,1) locked')).rows[0].locked;
  assert.ok(locked,'Another backup is running');
  if(mode==='--preview'){
   await db.query('begin read only');
   const result={read_only:true,project:PROJECT,server_version:(await db.query('show server_version')).rows[0].server_version,database_bytes:(await db.query('select pg_database_size(current_database())::text bytes')).rows[0].bytes,
    pending_checkpoints:(await db.query('select count(*)::int n from backup.draft_checkpoints c where not exists(select 1 from backup.receipts r where r.checkpoint_id=c.id)')).rows[0].n};
   await db.query('rollback');return result;
  }
  if(mode==='--drafts'&&!(await db.query('select 1 from backup.draft_checkpoints c where not exists(select 1 from backup.receipts r where r.checkpoint_id=c.id) limit 1')).rows.length)return {uploaded:0,pending:0};
  const key=keyFrom(env.BACKUP_ENCRYPTION_KEY);dir=await mkdtemp(join(tmpdir(),'pentagon-backup-'));
  const bundle=await exportDatabase(db,config,dir),bytes=encryptBundle(bundle,key);
  const file=join(dir,'export.pcbackup');await writeFile(file,bytes,{mode:0o600});
  const metrics={encrypted_bytes:bytes.length,dump_bytes:Buffer.from(bundle.dump,'base64').length,database_bytes:bundle.database_bytes,rows:bundle.inventory.reduce((n,t)=>n+Number(t.count),0)};
  if(mode==='--local'){await writeFile(output,bytes,{flag:'wx',mode:0o600});return {local_only:true,...metrics};}
  const r2=r2Settings(env),groups=mode==='--drafts'?[...new Set(bundle.checkpoints.map(c=>c.draft_id))]:[null],uploaded=[];
  for(const draftId of groups){
   const terminal=bundle.drafts.find(d=>d.id===draftId)?.status;
   const kind=draftId?(['completed','cancelled'].includes(terminal)?'final':'draft'):mode.slice(2);
   const object=objectKey(kind,draftId?`${draftId}-${randomUUID()}`:randomUUID());
   const digest=await uploadVerified(r2,file,object,dir);
   // A receipt is recorded only after reading the encrypted object back and
   // verifying its checksum. Crash-before-receipt retries create an extra safe copy.
   if(draftId){
    await db.query('begin');
    try{for(const c of bundle.checkpoints.filter(c=>c.draft_id===draftId))await db.query('insert into backup.receipts(checkpoint_id,object_key,sha256) values($1,$2,$3) on conflict do nothing',[c.id,object,digest]);await db.query('commit');}
    catch(e){await db.query('rollback');throw e;}
   }
   uploaded.push({key:object,...metrics});
  }
  return {uploaded,standings_changed:false};
 }finally{if(dir)await rm(dir,{recursive:true,force:true});await db.end().catch(()=>{});}
}
