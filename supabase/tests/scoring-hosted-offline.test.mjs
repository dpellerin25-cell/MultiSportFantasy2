import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID as uuid} from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateHostedScoring} from './scoring-hosted-validation.mjs';
const {prepareValue}=createRequire(import.meta.url)('pg/lib/utils');
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const users={doug:uuid(),chris:uuid()};
 for(const [slug,id] of Object.entries(users)){
   await db.query('insert into auth.users values($1)',[id]);
   await db.query('insert into draft.owner_accounts select $1,id from draft.owners where slug=$2',[id,slug]);
 }
 await db.query("insert into draft.league_roles values($1,'commissioner')",[users.doug]);
 const client={query:(s,p=[])=>db.query(s,p.map(v=>v!==null&&typeof v==='object'?prepareValue(v):v))};
 const empty=async()=>{for(const table of ['seasons','periods','results','contributions','roster_checks','pause_events','decisions','pga_resolutions'])assert.equal((await db.query(`select count(*)::int n from scoring.${table}`)).rows[0].n,0);};
 await db.exec('begin');await validateHostedScoring(client,users.doug,users.chris);await db.exec('rollback');await empty();
 await db.exec('begin');await assert.rejects(()=>validateHostedScoring(client,users.doug,users.chris,()=>{throw Error('Injected failure after fixtures');}),/Injected/);await db.exec('rollback');await empty();
 await db.exec('begin');await assert.rejects(()=>validateHostedScoring(client,users.doug,users.doug),/distinct/);await db.exec('rollback');
 await db.exec('begin');await assert.rejects(()=>validateHostedScoring(client,users.doug,uuid()),/linked/);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int n from draft.owner_accounts')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from draft.league_roles')).rows[0].n,1);
 console.log('PASS hosted scoring scenario offline; success/failure rollback, unchanged account links and prerequisite guards. No hosted requests made.');
}finally{await db.close();}
