import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {scoringTestConfig} from './scoring-test-config.mjs';
import {scoringRaceScenarios} from './scoring-race-scenarios.mjs';
const {prepareValue}=createRequire(import.meta.url)('pg/lib/utils');

for(const value of [undefined,'bad','postgresql://u:p@remote:5432/multisport_scoring_test','postgresql://u:p@localhost:5432/postgres','postgresql://u@localhost:5432/multisport_scoring_test','postgresql://u:p@localhost:5432/multisport_scoring_test?host=remote'])assert.throws(()=>scoringTestConfig(value));
assert.ok(scoringTestConfig('postgresql://u:p@127.0.0.1:5432/multisport_scoring_test'));
const db=await PGlite.create();let passed=0;
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 // Rehearse using the real driver's parameter encoding, including its special
 // handling of arrays. PGlite's native JSON conversion otherwise hides errors.
 const admin={query:(s,p)=>p?db.query(s,p.map(value=>value!==null&&typeof value==='object'?prepareValue(value):value)):db.exec(s).then(results=>results.at(-1))};
 const race=async(firstOp,secondOp)=>{
   await db.exec('begin');let first;
   try{first=await firstOp(admin);await db.exec('commit');}catch(e){await db.exec('rollback');throw e;}
   await db.exec('begin');let second;
   try{second={value:await secondOp(admin)};await db.exec('commit');}catch(error){await db.exec('rollback');second={error};}
   return {first,second};
 };
 await scoringRaceScenarios({admin,race,report:message=>{passed++;console.log('PASS sequential rehearsal: '+message);}});
 console.log(`PASS target guards and ${passed} scoring scenarios offline. NOT multi-session concurrency proof.`);
}finally{await db.close();}
