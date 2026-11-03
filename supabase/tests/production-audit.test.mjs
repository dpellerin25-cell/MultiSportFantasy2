import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {collectAudit,assessAudit,queries} from './production-audit.mjs';
import {connectionConfig} from './hosted-validation.mjs';
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;`);
 const dir=new URL('../migrations/',import.meta.url),files=(await readdir(dir)).filter(x=>x.endsWith('.sql')).sort();
 for(const file of files)await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.exec('create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text)');
 const versions=files.map(x=>x.split('_')[0]);
 for(const v of versions)await db.query('insert into supabase_migrations.schema_migrations values($1)',[v]);
 const expected=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
 await db.query("insert into auth.users values(gen_random_uuid(),'PRIVATE_SENTINEL@example.com')");
 const before=await db.query('select count(*)::int n from draft.owners');
 const snapshot=await collectAudit(db);
 assert.deepEqual(snapshot.unavailable,[],'Every fixed query must run against real migrations');
 assert.deepEqual(await db.query('select count(*)::int n from draft.owners'),before);
 const report=assessAudit(snapshot,expected,versions);
 assert.equal(report.findings.find(x=>x.check==='migration_versions').status,'verified');
 assert.equal(report.findings.find(x=>x.check==='owner_accounts').status,'needs_attention');
 assert.equal(report.findings.find(x=>x.check==='current_rules').status,'verified');
 assert.equal(report.ready_for_production,false);
 assert.ok(report.findings.some(x=>x.status==='not_yet_verified'));
 assert.ok(!JSON.stringify(report).includes('PRIVATE_SENTINEL'));
 // A missing table must not abort remaining checks or produce a false pass.
 await db.exec('drop table supabase_migrations.schema_migrations');
 const missing=await collectAudit(db);assert.deepEqual(missing.unavailable,['migrations']);
 assert.equal(assessAudit(missing,expected,versions).findings.find(x=>x.check==='migrations').status,'not_yet_verified');
 const changed=structuredClone(snapshot);changed.data.policy[0].roster_limit=65;
 changed.data.scoring=[{sport:'MLB',is_test:true,publish:true,errors:1}];
 changed.data.commissioners=[{slug:'chris',active:true}];
 const findings=assessAudit(changed,expected,[...versions,'999999999999']).findings;
 for(const key of ['current_rules','test_scoring_hidden','scoring_errors','commissioner_roles','migration_versions'])assert.equal(findings.find(x=>x.check===key).status,'needs_attention');
 assert.throws(()=>connectionConfig('postgresql://postgres:private@localhost:5432/postgres'));
 assert.equal(connectionConfig('postgresql://postgres:private@db.tgvuntuhdqucazpoxrrg.supabase.co:5432/postgres').ssl.rejectUnauthorized,true);
 // Verify actual read-only enforcement and cleanup after a read error.
 await db.exec('begin read only');await assert.rejects(()=>db.query("insert into auth.users values(gen_random_uuid(),'secret@example.com')"));await db.exec('rollback');
 const calls=[];await assert.rejects(()=>collectAudit({query:async s=>{calls.push(s);if(s.startsWith('show'))return {rows:[{transaction_read_only:'off'}]};return {rows:[]};}}));assert.equal(calls.at(-1),'rollback');
 for(const sql of Object.values(queries))assert.match(sql,/^(select|with) /i);
 console.log('PASS actual-migration audit queries, read-only write rejection, rollback, missing-schema isolation, findings, TLS/project guards and no private identity export. No hosted database contacted.');
}finally{await db.close();}
