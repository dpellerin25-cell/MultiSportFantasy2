import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ensureExtensionSchema,verifyRestoreInventory} from './backup-restore.mjs';
import {checkCompatibility,bootstrap,RESTORE_IMAGE} from './backup-real-guards.mjs';
const bundle={server_version:'17.6',extensions:[{extname:'pg_cron',extversion:'1.6.4'},{extname:'supabase_vault',extversion:'0.3.1'}]};
const available=[{name:'pg_cron',version:'1.6.4'},{name:'supabase_vault',version:'0.3.1'}];
checkCompatibility(bundle,'17.6',available);
assert.throws(()=>checkCompatibility(bundle,'16.6',available));
assert.throws(()=>checkCompatibility(bundle,'17.6',available.slice(0,1)),{code:'EXTENSION_VERSION_MISSING'});
assert.throws(()=>checkCompatibility(bundle,'17.6',[available[0],{name:'supabase_vault',version:'0.4.0'}]),{code:'EXTENSION_VERSION_MISSING'});
assert.match(RESTORE_IMAGE,/^supabase\/postgres:17\./);
assert.match(bootstrap,/cron.launch_active_jobs=off/);
assert.match(bootstrap,/listen_addresses=''/);
const runner=await readFile(new URL('./restore-real-backup.mjs',import.meta.url),'utf8');
assert.match(runner,/'--network','none'/);
assert.match(runner,/docker\(\['rm','-fv',container\]\)/);
assert.ok(!runner.includes('DRAFT_TEST_DATABASE_URL')&&!runner.includes('TRADE_ROSTER_DATABASE_URL'));
const db=await PGlite.create();
const tables=[{schemaname:'auth',tablename:'oauth_clients',count:'2',checksum:'one'},{schemaname:'auth',tablename:'oauth_client_states',count:'1',checksum:'two'}];
verifyRestoreInventory(tables,[...tables].reverse());
for(const actual of [tables.slice(1),[...tables,{schemaname:'auth',tablename:'extra',count:'0',checksum:'x'}],[{...tables[0],count:'3'},tables[1]],[{...tables[0],checksum:'changed'},tables[1]]]){
 assert.throws(()=>verifyRestoreInventory(tables,actual),e=>e.code==='RESTORE_CONTENT_MISMATCH'&&!JSON.stringify(e.safeDifferences).includes('checksum'));
}
assert.throws(()=>verifyRestoreInventory(tables,[tables[0],tables[0]]));
console.log('PASS table ordering independence; missing/extra tables, changed counts and changed content still fail with metadata-only diagnostics.');
try{
 await db.query('set allow_system_table_mods=off');
 await assert.rejects(()=>db.query('create schema if not exists pg_catalog'),{code:'42939'});
 await ensureExtensionSchema(db,'pg_catalog');
 await ensureExtensionSchema(db,'extensions');
 await ensureExtensionSchema(db,'extensions');
 await assert.rejects(()=>ensureExtensionSchema(db,'pg_nonexistent_reserved'));
 assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname='extensions'")).rows[0].n,1);
}finally{await db.close();}
console.log('PASS reserved pg_catalog 42939 reproduction and schema reuse; real-restore version/extension refusal and isolation configuration. Offline only; no Docker or actual backup restored.');
