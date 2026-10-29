import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {importScoring,validateScoringImport} from './scoring-import.mjs';
import {CONFIRMATION_ID} from './scoring-nonparticipation.mjs';
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 for(const [sport,number] of [['MLB',2],['NBA',1],['PGA',3]]){
   const diagnostic=JSON.parse(execFileSync(process.env.PYTHON??'python3',['scripts/diagnose_scoring.py','--sport',sport,'--response',`scripts/fixtures/scoring/${sport.toLowerCase()}.json`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}}));
   const original={version:1,is_test:true,season_year:2026,observed_at:'2026-10-27T12:00:00Z',expected_revision:0,reason:'Offline captured evidence',diagnostic,...(sport==='PGA'?{tournament_start:'2026-06-11'}:{})};
   const correction={...structuredClone(original),observed_at:'2026-10-29T00:00:00Z',expected_revision:1,reason:'Commissioner non-participation confirmation',non_participation_confirmation:{id:CONFIRMATION_ID,original_envelope:original}};
   await assert.rejects(()=>importScoring(db,correction),/original capture/);
   const p=await importScoring(db,original);await importScoring(db,original,{apply:true,approval:p.plan_hash});
   const preview=await importScoring(db,correction);
   assert.equal(preview.revision,2);assert.equal(preview.confirmed_non_participants.length,number);assert.equal(preview.outcome.status,'pending');
   assert.equal(preview.missing_records,p.missing_records-number);
   assert.equal((await db.query("select count(*)::int n from scoring.results r join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.sport=$1",[sport])).rows[0].n,1);
   const applied=await importScoring(db,correction,{apply:true,approval:preview.plan_hash});
   assert.equal(applied.starter_total,p.starter_total);assert.equal(applied.bench_total,p.bench_total);
   assert.equal((await importScoring(db,correction,{apply:true,approval:preview.plan_hash})).already_imported,true);
   const records=(await db.query("select r.revision,c.* from scoring.contributions c join scoring.results r on r.id=c.result_id join scoring.periods p on p.id=r.period_id join scoring.seasons s on s.id=p.season_id where s.sport=$1",[sport])).rows;
   const confirmed=records.filter(r=>r.score_state==='no_activity');assert.equal(confirmed.length,number);
   for(const c of confirmed){assert.equal(c.raw_points,null);assert.ok(JSON.parse(c.evidence).original_checksum);assert.equal(records.find(r=>r.revision===1&&r.player_id===c.player_id).score_state,'unknown');}
   const wrong=structuredClone(correction);wrong.diagnostic.owner='Other';for(const player of wrong.diagnostic.players)player.owner='Other';assert.throws(()=>validateScoringImport(wrong),/No commissioner/);
   const changed=structuredClone(correction);changed.diagnostic.players.find(p=>p.stat_record_present).player_name='Changed';assert.throws(()=>validateScoringImport(changed),/cannot alter/);
   const alreadyKnown=structuredClone(correction);const id=applied.confirmed_non_participants[0].player_id;
   for(const d of [alreadyKnown.diagnostic,alreadyKnown.non_participation_confirmation.original_envelope.diagnostic]){const player=d.players.find(p=>p.player_id===id);player.stat_record_present=true;player.fantasy_points=0;player.team_contribution=0;}
   assert.throws(()=>validateScoringImport(alreadyKnown),/missing starter/);
 }
 console.log('PASS six exact commissioner confirmations, raw blanks and originals preserved, pending eligibility, preview rollback, idempotent revision 2 and rejection of unconfirmed/altered/known records. No hosted writes.');
}finally{await db.close();}
