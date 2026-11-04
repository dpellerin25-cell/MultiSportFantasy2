import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {PROJECT,PREFIX,encryptBundle,decryptBundle,keyFrom,sha,objectKey,retention,inventory} from './backup-core.mjs';
import {restoreConfig} from './backup-restore.mjs';
import {r2Settings,uploadVerified} from './backup-io.mjs';
import {backupFailureCode} from './backup-errors.mjs';
assert.equal(backupFailureCode({stderr:'pg_restore: schema "public" already exists PRIVATE_SECRET'}),'SCHEMA_EXISTS');
assert.equal(backupFailureCode({stderr:'BACKUP_CODE:SNAPSHOT_INVALID PRIVATE_SECRET'}),'SNAPSHOT_INVALID');
assert.equal(backupFailureCode({code:'42501',message:'PRIVATE_SECRET'}),'42501');
assert.equal(backupFailureCode({stderr:'PRIVATE_SECRET postgres://secret'}),'UNCLASSIFIED');
const key=randomBytes(32),bundle={version:1,project:PROJECT,dump:Buffer.from('synthetic dump').toString('base64'),dump_sha256:sha(Buffer.from('synthetic dump'))};
assert.deepEqual(decryptBundle(encryptBundle(bundle,key),key),bundle);
assert.notDeepEqual(encryptBundle(bundle,key),encryptBundle(bundle,key));
const damaged=encryptBundle(bundle,key);damaged[damaged.length-1]^=1;
assert.throws(()=>decryptBundle(damaged,key));assert.throws(()=>decryptBundle(encryptBundle(bundle,key),randomBytes(32)));
assert.throws(()=>keyFrom('bad'));assert.deepEqual(keyFrom(key.toString('base64')),key);
assert.throws(()=>restoreConfig('postgresql://postgres:fake@db.example.com:5432/postgres','postgres'));
assert.throws(()=>restoreConfig('postgresql://postgres:fake@127.0.0.1:5432/postgres','postgres'));
assert.equal(restoreConfig('postgresql://postgres:fake@127.0.0.1:5432/pentagon_restore_test','pentagon_restore_test').database,'pentagon_restore_test');
assert.throws(()=>r2Settings({R2_ENDPOINT:'https://evil.example.com',R2_BUCKET:'pentagon-cup-backups'}));
console.log('PASS authenticated encryption, unique nonces, wrong-key/tamper rejection and restore/R2 destination guards');
const now=new Date('2027-05-01T12:00:00Z'),objects=[];
for(let i=0;i<100;i++){
 const date=new Date(now-i*86400000);objects.push({Key:objectKey('daily',randomUUID(),date),LastModified:date.toISOString(),Size:100});
}
const draftA=randomUUID(),draftB=randomUUID();
const old=new Date('2027-01-02T00:00:00Z'),final=new Date('2027-01-03T00:00:00Z');
const round=objectKey('draft',`${draftA}-${randomUUID()}`,old),active=objectKey('draft',`${draftB}-${randomUUID()}`,old),finalKey=objectKey('final',`${draftA}-${randomUUID()}`,final);
objects.push(...[{Key:round,LastModified:old},{Key:active,LastModified:old},{Key:finalKey,LastModified:final},{Key:'unrelated-file',LastModified:old}]);
const plan=retention(objects,now);
assert.ok(plan.remove.includes(round));assert.ok(plan.keep.includes(active));assert.ok(plan.keep.includes(finalKey));assert.ok(!plan.remove.includes('unrelated-file'));
assert.ok(plan.keep.filter(k=>k.includes('/daily/')).length>=14&&plan.keep.filter(k=>k.includes('/daily/')).length<=22);
assert.ok(retention(objects,new Date('2027-01-10')).keep.includes(round));
const dir=await mkdtemp(join(tmpdir(),'backup-test-'));
try{
 const bytes=encryptBundle(bundle,key),file=join(dir,'test.pcbackup');await writeFile(file,bytes);
 let stored;
 const request=async(c,op,args)=>{
  if(op==='put-object'){assert.ok(args.includes('--if-none-match'));stored=await readFile(args[args.indexOf('--body')+1]);}
  else await writeFile(args.at(-1),stored);
 };
 assert.equal(await uploadVerified({},file,objectKey('manual',randomUUID()),dir,request),sha(bytes));
 await assert.rejects(()=>uploadVerified({},file,objectKey('manual',randomUUID()),dir,async(c,op,args)=>{if(op==='get-object')await writeFile(args.at(-1),'corrupt');}));
}finally{await rm(dir,{recursive:true,force:true});}
console.log('PASS retention: 14 daily dates/eight weeks, final/manual preservation, active-draft retention, scoped deletes and verified upload failures');
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const migrations=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,migrations),'utf8'));
 const owners=await q("select id from draft.owners where slug in ('doug','chris') order by slug");
 const id=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,pick_duration_seconds) values('backup synthetic','free_agent',2027,2,2,60) returning id"))[0].id;
 for(let i=0;i<2;i++)await q('insert into draft.draft_participants values($1,$2,$3)',[id,owners[i].id,i+1]);
 await q('select draft.generate_snake_picks($1)',[id]);
 await q("update draft.drafts set status='running',current_pick_number=1,deadline_at=now()-interval '1 hour' where id=$1",[id]);
 assert.equal((await q('select count(*)::int n from backup.draft_checkpoints'))[0].n,1);
 const expire=async()=>{await q("update draft.drafts set deadline_at=now()-interval '1 hour' where id=$1",[id]);await q('select draft.expire_due_picks()');};
 await q('begin');await expire();await q('rollback');
 assert.equal((await q('select count(*)::int n from backup.draft_checkpoints'))[0].n,1);
 await expire();await expire();
 const round1=(await q('select * from backup.draft_checkpoints order by revision desc limit 1'))[0];
 assert.deepEqual(round1.completed_rounds,[1]);assert.equal(round1.payload.draft_picks.length,4);
 assert.equal(round1.payload.draft_events.filter(e=>e.event_type==='timer_expire').length,2);
 await q('update draft.drafts set revision=revision where id=$1',[id]);
 assert.equal((await q('select count(*)::int n from backup.draft_checkpoints'))[0].n,2);
 await expire();await expire();
 const latest=(await q('select * from backup.draft_checkpoints order by revision desc limit 1'))[0];assert.deepEqual(latest.completed_rounds,[1,2]);
 await q("update draft.drafts set status='cancelled',revision=revision+1 where id=$1",[id]);
 assert.equal((await q('select terminal from backup.draft_checkpoints order by revision desc limit 1'))[0].terminal,true);
 await assert.rejects(()=>q('delete from backup.draft_checkpoints'));
 for(const role of ['anon','authenticated']){await q(`set role ${role}`);await assert.rejects(()=>q('select * from backup.draft_checkpoints'));await q('reset role');}
 const before=await inventory(db);assert.ok(before.some(t=>t.schemaname==='auth'));assert.ok(before.some(t=>t.schemaname==='backup'));
 console.log('PASS real migrations: start/round/skipped-slot checkpoints, deferred event inclusion, rollback/retry, terminal checkpoint, private immutable history and inventory');
}finally{await db.close();}
