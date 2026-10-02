// Sequential rehearsal only; cannot prove locks or simultaneous execution.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {membershipRaceScenarios} from './membership-race-scenarios.mjs';
const db=await PGlite.create();let passed=0;
try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const race=async(firstOp,secondOp)=>{
  await db.query('begin');let first;
  try{first=await firstOp(db);await db.query('commit');}catch(e){await db.query('rollback');throw e;}
  await db.query('begin');let second;
  try{second={value:await secondOp(db)};await db.query('commit');}catch(error){await db.query('rollback');second={error};}
  return {first,second};
 };
 await membershipRaceScenarios({admin:db,race,report:message=>{passed++;console.log('PASS sequential: '+message);}});
 console.log(`PASS ${passed} membership race scenarios rehearsed offline. NOT multi-session concurrency proof.`);
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await db.close();}
