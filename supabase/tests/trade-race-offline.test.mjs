// Check shared fixtures/assertions sequentially; explicitly NOT a lock/race test.
import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {tradeRaceScenarios} from './trade-race-scenarios.mjs';
const db=await PGlite.create();let passed=0;
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const race=async(firstOp,secondOp,beforeRelease=async()=>{})=>{
    await db.query('begin');let first;
    try{first=await firstOp(db);await db.query('commit');}catch(e){await db.query('rollback');throw e;}
    await beforeRelease();await db.query('begin');let second;
    try{second={value:await secondOp(db)};await db.query('commit');}catch(error){await db.query('rollback');second={error};}
    return {first,second};
  };
  await tradeRaceScenarios({admin:db,race,report:()=>{passed++;}});
  console.log(`PASS ${passed} shared trade race scenarios in sequential offline mode. NOT multi-session concurrency validation.`);
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await db.close();}
