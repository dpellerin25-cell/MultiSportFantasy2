import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createCheckpointRehearsal,checkpointStatus,REHEARSAL_ID} from './backup-rehearsal.mjs';
const db=await PGlite.create();
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const real=(await db.query("insert into draft.drafts(name,kind,championship_year,rounds,participant_count) values('Untouched startup','startup',2027,80,2) returning *")).rows[0];
 const before=(await db.query('select * from trading.prospects')).rows;
 assert.equal((await checkpointStatus(db)).exists,false);
 const created=await createCheckpointRehearsal(db);assert.equal(created.checkpoints.length,3);assert.equal(created.status,'cancelled');assert.equal(created.all_uploaded,false);
 assert.equal((await createCheckpointRehearsal(db)).already_created,true);
 assert.deepEqual((await db.query('select * from draft.drafts where id=$1',[real.id])).rows[0],real);
 assert.deepEqual((await db.query('select * from trading.prospects')).rows,before);
 assert.equal((await db.query('select count(*)::int n from draft.draft_selections')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from backup.draft_checkpoints where draft_id=$1',[REHEARSAL_ID])).rows[0].n,3);
 assert.deepEqual(created.checkpoints.map(c=>c.completed_rounds),[[],[1],[1]]);
 console.log('PASS isolated checkpoint creation, start/round/terminal boundaries, cancelled state, retry, no selections and real draft/rosters preserved. No hosted service or R2 contacted.');
}finally{await db.close();}
