import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {importScoring,validateScoringImport} from './scoring-import.mjs';
import {importHistoricalChecks} from './scoring-roster-import.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const db=await PGlite.create();
const one=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const totals={NFL:20.45,MLB:1,NBA:124,EPL:8,PGA:127};let mlb;
 for(const sport of Object.keys(totals)){
   const diagnostic=JSON.parse(execFileSync(process.env.PYTHON??'python3',['scripts/diagnose_scoring.py','--sport',sport,'--response',`scripts/fixtures/scoring/${sport.toLowerCase()}.json`],{cwd:root,encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
   // Actual captured scores; synthetic import timestamps for offline tests only.
   const envelope={version:1,is_test:true,season_year:2026,observed_at:'2026-10-27T12:00:00Z',expected_revision:0,reason:'Offline capture import test',diagnostic,...(sport==='PGA'?{tournament_start:'2026-06-11'}:{})};
   const before=Number(await one('select count(*) from scoring.results'));
   const preview=await importScoring(db,envelope);
   assert.equal(Number(await one('select count(*) from scoring.results')),before);
   assert.equal(preview.starter_total,totals[sport]);assert.equal(preview.outcome.status,'pending');
   await assert.rejects(()=>importScoring(db,envelope,{apply:true,approval:'wrong'}),/Approval/);
   const result=await importScoring(db,envelope,{apply:true,approval:preview.plan_hash});
   assert.equal(result.revision,1);assert.equal(result.championship_year,null);
   const retry=await importScoring(db,envelope,{apply:true,approval:preview.plan_hash});assert.equal(retry.already_imported,true);
   assert.equal(Number(await one('select count(*) from scoring.results')),before+1);
   if(sport==='MLB')mlb=envelope;
 }
 assert.equal(Number(await one('select count(*) from scoring.seasons where not is_test or championship_year is not null')),0);
 const correction=structuredClone(mlb);correction.observed_at='2026-10-27T13:00:00Z';correction.expected_revision=1;correction.reason='Synthetic correction test';
 const player=correction.diagnostic.players.find(p=>p.lineup_group==='ACTIVE'&&p.stat_record_present);
 player.fantasy_points+=1;player.team_contribution+=1;correction.diagnostic.active_total+=1;
 const preview=await importScoring(db,correction);await importScoring(db,correction,{apply:true,approval:preview.plan_hash});
 assert.equal(Number(await one("select count(*) from scoring.results r join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.sport='MLB'")),2);
 assert.equal(Number(await one("select starter_total from scoring.results r join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.sport='MLB' and r.revision=1")),1);
 await assert.rejects(()=>importScoring(db,{...correction,expected_revision:0}),/Stale/);
 const old=await importScoring(db,mlb);assert.equal(old.outcome.status,'superseded');
 for(const mutate of [e=>e.is_test=false,e=>e.diagnostic.players.push(e.diagnostic.players[0]),e=>e.diagnostic.active_total=999,e=>e.diagnostic.players[0].owner='Other']){
   const bad=structuredClone(mlb);mutate(bad);assert.throws(()=>validateScoringImport(bad));
 }
 const bad=structuredClone(mlb);bad.diagnostic.owner='Unknown owner';for(const p of bad.diagnostic.players)p.owner='Unknown owner';
 await assert.rejects(()=>importScoring(db,bad),/exactly match/);
 // Synthetic counts only: no claim that these historical rosters were captured.
 const snapshots=Object.fromEntries(['NFL','MLB','NBA','EPL','PGA'].map((sport,i)=>{
   const players=i?[]:Array.from({length:66},(_,j)=>({player_id:String(j)}));
   return [sport,{sport,league_id:'synthetic-'+sport,updated_at:'2026-10-24T08:05:00Z',team_count:1,total_players:players.length,rosters:[{owner:'Hatch',player_count:players.length,players}]}];
 }));
 const counts={version:1,is_test:true,check_date:'2026-10-24',expected_revision:0,reason:'Synthetic roster integration test',snapshots};
 const countsPreview=await importHistoricalChecks(db,counts);
 assert.equal(Number(await one('select count(*) from scoring.roster_checks')),0);
 await importHistoricalChecks(db,counts,{apply:true,approval:countsPreview.plan_hash});
 await importHistoricalChecks(db,counts,{apply:true,approval:countsPreview.plan_hash});
 assert.equal(Number(await one('select count(*) from scoring.roster_checks')),1);
 assert.equal((await one("select outcome from scoring.current_outcomes where sport='NBA'")).status,'pending');
 const late=structuredClone(counts);late.expected_revision=1;late.snapshots.PGA.updated_at='2026-10-24T10:00:00Z';
 await assert.rejects(()=>importHistoricalChecks(db,late),/4am/);
 assert.equal(Number(await one('select count(*) from scoring.roster_checks')),1);
 const missing=structuredClone(counts);delete missing.snapshots.PGA;
 await assert.rejects(()=>importHistoricalChecks(db,missing),/All five/);
 const compliant=structuredClone(counts);compliant.expected_revision=1;compliant.snapshots.NFL.rosters[0].players.pop();compliant.snapshots.NFL.rosters[0].player_count=65;compliant.snapshots.NFL.total_players=65;
 const cp=await importHistoricalChecks(db,compliant);await importHistoricalChecks(db,compliant,{apply:true,approval:cp.plan_hash});
 assert.equal((await one("select outcome from scoring.current_outcomes where sport='NBA'")).status,'pending');
 console.log('PASS five actual captured examples, rollback preview, approved test-only imports, exact retries, correction history, stale revision and malformed evidence rejection. No hosted database contacted.');
 console.log('PASS historical five-sport count integration using synthetic snapshots, retries, 65/66 correction, missing/late snapshot rejection and atomic rollback.');
}finally{await db.close();}

