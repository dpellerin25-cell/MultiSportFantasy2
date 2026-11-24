import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {auditPermissions} from './permissions-audit.mjs';
const db=await PGlite.create();
try{
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const owners=(await db.query('select id,slug from draft.owners where active')).rows;
  for(const o of owners){const id=randomUUID();await db.query('insert into auth.users values($1)',[id]);await db.query('insert into draft.owner_accounts values($1,$2)',[id,o.id]);if(o.slug==='doug')await db.query("insert into draft.league_roles values($1,'commissioner')",[id]);}
  async function run(){await db.exec('begin read only');try{return await auditPermissions(db,{expectedOwners:owners.length});}finally{await db.exec('rollback');}}
  assert.equal((await run()).results.length,owners.length);
  console.log('PASS read-only linked-owner identity, private tables, commissioner reads, owner/outsider/anonymous denials');
  await db.exec('grant update on draft.owner_accounts to authenticated');
  await assert.rejects(run);
  await db.exec('revoke update on draft.owner_accounts from authenticated');
  await db.exec("create or replace function public.prospect_admin() returns jsonb language sql stable security definer as $$select '{}'::jsonb$$");
  await assert.rejects(run);
  console.log('PASS audit detects unsafe table grants and missing commissioner checks. No hosted services contacted.');
}finally{await db.close();}
