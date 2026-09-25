import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {connectionConfig,signIn,validateHostedCommands,PROJECT} from './hosted-validation.mjs';

const good=`postgresql://postgres:placeholder@db.${PROJECT}.supabase.co:5432/postgres`;
assert.equal(connectionConfig(good).ssl.rejectUnauthorized,true);
assert.equal(connectionConfig(`postgresql://postgres.${PROJECT}:placeholder@aws-0-us-east-1.pooler.supabase.com:5432/postgres`).port,5432);
for(const bad of [undefined,good.replace(PROJECT,'production'),good+'?sslmode=disable',good.replace(':5432',':6543'),good.replace('/postgres','/other'),good.replace('postgres:placeholder','other:placeholder')])assert.throws(()=>connectionConfig(bad));
console.log('PASS test-project target guards and verified TLS');
await assert.rejects(()=>signIn('key','a@test.invalid','pw',async()=>({ok:false,status:401})),/sign-in failed/);
await assert.rejects(()=>signIn('key','a@test.invalid','pw',async url=>url.includes('/token')?{ok:true,json:async()=>({access_token:'fixture'})}:{ok:true,json:async()=>({id:randomUUID(),email:'different@test.invalid',email_confirmed_at:'now'})}),/matching email/);
console.log('PASS Auth failures and mismatched identities rejected');
const db=await PGlite.create();
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
  const a=randomUUID(),b=randomUUID();await db.query('insert into auth.users values($1),($2)',[a,b]);
  await db.exec('begin');
  await validateHostedCommands(db,a,b);
  await db.exec('rollback');
  for(const table of ['drafts','players','owner_accounts','league_roles','player_pool_imports'])assert.equal(Number((await db.query(`select count(*) n from draft.${table}`)).rows[0].n),0);
  console.log('PASS shared hosted scenario offline and rollback cleanup (not a hosted test)');
} finally {await db.close();}
