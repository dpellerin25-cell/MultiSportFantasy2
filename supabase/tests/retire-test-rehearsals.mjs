// Restricted to the two identified rehearsals in the disposable test project.
import pg from 'pg';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
import {checksum} from './yearly-renewal.mjs';
const targets=[
 ['8aac4d8c-f8da-424d-ae63-5b6259e4c170','Disposable realtime/timer test',2],
 ['4f7c9484-bc03-46cf-ae5f-8a0781061844','Startup draft rehearsal',9],
];
let db;
try{
 const mode=process.argv[2];assert.ok(['--preview','--apply'].includes(mode)&&process.argv.length===3);
 assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
 db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();
 await db.query(mode==='--preview'?'begin isolation level repeatable read read only':'begin');
 await db.query("set local lock_timeout='15s';set local statement_timeout='30s'");
 if(mode==='--apply'){
  await db.query('select pg_advisory_xact_lock(20260925,2)');
  await db.query('select pg_advisory_xact_lock(731943,1)');
  await db.query('lock table draft.drafts in share row exclusive mode');
 }
 const rows=[];
 for(const [id,name,count] of targets){
  const d=(await db.query(`select d.id,d.name,d.status,d.revision,d.participant_count,d.championship_year,d.current_pick_number,
   exists(select 1 from draft.retired_rehearsals r where r.draft_id=d.id) retired,
   (select count(*)::int from draft.draft_picks p where p.draft_id=d.id) pick_slots,
   (select count(*)::int from draft.draft_selections s where s.draft_id=d.id) selections
   from draft.drafts d where id=$1`,[id])).rows[0];
  assert.ok(d);assert.equal(d.name,name);assert.equal(d.participant_count,count);assert.equal(d.championship_year,2027);
  assert.ok(['paused','awaiting_makeups','cancelled'].includes(d.status));rows.push(d);
 }
 const hash=checksum(rows);
 if(mode==='--apply'&&!rows.every(r=>r.retired)){
  assert.equal(process.env.REHEARSAL_RETIRE_APPROVE,hash,'Review the latest preview hash before applying');
  for(const d of rows)await db.query('select draft.retire_rehearsal($1,$2,$3)',[d.id,d.revision,'Confirmed pre-league test rehearsal; retain history and permit approved membership expansion.']);
 }
 await db.query(mode==='--apply'?'commit':'rollback');
 console.log(JSON.stringify({project:PROJECT,applied:mode==='--apply',drafts:rows,...(mode==='--preview'?{approval_hash:hash}:{}),history_preserved:true},null,2));
}catch{console.error('Rehearsal retirement failed. Check test-project settings, migration, exact fixture identities and fresh approval hash. No partial retirement requested; retry preview after uncertain connection loss.');process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
