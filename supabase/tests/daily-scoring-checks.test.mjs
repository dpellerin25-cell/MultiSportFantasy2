import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {dailyCheckPlan,storeDailyChecks} from './daily-scoring-checks.mjs';
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const snapshots=(stamp,count=66)=>['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>({sport,league:'synthetic',observed:stamp,rosters:[{owner:'doug',players:Array.from({length:i?0:count},(_,n)=>({player_id:String(n)}))}],count:i?0:count}));
 const s=snapshots('2020-06-11T08:05:00Z');
 assert.equal(dailyCheckPlan(s,'2020-06-11T08:10:00Z').complete,true);
 assert.equal(dailyCheckPlan(s,'2020-06-11T09:00:00Z').complete,false);
 assert.equal(dailyCheckPlan(snapshots('2020-01-11T09:05:00Z'),'2020-01-11T09:10:00Z').complete,true);
 assert.ok(dailyCheckPlan(s,'2020-06-12T08:10:00Z').skipped);
 await db.exec('begin');await storeDailyChecks(db,s,'2020-06-11T08:10:00Z');await db.exec('commit');
 await db.exec('begin');const retry=await storeDailyChecks(db,s,'2020-06-11T08:10:00Z');await db.exec('commit');
 assert.equal(retry.owners[0].status,'already_recorded');
 await db.exec('begin');const changed=await storeDailyChecks(db,snapshots('2020-06-11T08:20:00Z',65),'2020-06-11T08:30:00Z');await db.exec('commit');
 assert.equal(changed.owners[0].status,'existing_check_preserved');
 assert.equal((await db.query('select total_players from scoring.roster_checks')).rows[0].total_players,66);
 await db.exec('begin');await storeDailyChecks(db,snapshots('2020-06-12T10:00:00Z'),'2020-06-12T10:10:00Z');await db.exec('commit');
 assert.equal((await db.query("select complete from scoring.roster_checks where check_date='2020-06-12'")).rows[0].complete,false);
 await db.exec('begin');await storeDailyChecks(db,snapshots('2020-06-13T08:00:00Z'),'2020-06-13T08:10:00Z');await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int n from scoring.roster_checks')).rows[0].n,2);
 console.log('PASS scheduled count storage, summer/winter Eastern checks, late/incomplete reads, cross-date rejection, retries, first-check preservation and rollback');
}finally{await db.close();}
