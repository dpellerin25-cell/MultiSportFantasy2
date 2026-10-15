import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {mlbRaceScenario,scenarioNames} from './mlb-race-scenarios.mjs';
import {mlbTestConfig} from './mlb-test-config.mjs';
const good='postgresql://postgres:fake@127.0.0.1:5432/multisport_mlb_test';
assert.equal(mlbTestConfig(good).database,'multisport_mlb_test');
for(const bad of [undefined,good.replace('127.0.0.1','db.example.com'),good.replace('multisport_mlb_test','postgres'),good+'?sslmode=disable',good.replace(':fake',''),good.replace(':5432','')])assert.throws(()=>mlbTestConfig(bad));
const scenarios=[...scenarioNames.map(name=>({name,generic:false})),...scenarioNames.map(name=>({name,generic:true})),{name:'retired-pool-after-renewal',generic:true}];
for(const {name,generic} of scenarios){
 const db=await PGlite.create();
 try{
   await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
   const dir=new URL('../migrations/',import.meta.url);
   for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
   const race=async(firstOp,secondOp)=>{
     await db.query('begin');let first;
     try{first=await firstOp(db);await db.query('commit');}catch(e){await db.query('rollback');throw e;}
     await db.query('begin');let second;
     try{second={value:await secondOp(db)};await db.query('commit');}catch(error){await db.query('rollback');second={error};}
     return {first,second};
   };
   await mlbRaceScenario(name,{admin:db,race,generic});
   console.log('PASS sequential rehearsal: '+(generic?'yearly ':'legacy MLB ')+name);
 }finally{await db.close();}
}
console.log('PASS destination guards and nine offline scenarios. NOT multi-session concurrency validation.');
