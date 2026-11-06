import assert from 'node:assert/strict';
export const REHEARSAL_ID='b0e747d9-b596-4c71-9b0a-e0a39c2fc917';
const NAME='Backup checkpoint rehearsal (synthetic skipped round)';
export async function checkpointStatus(db){
 const d=(await db.query('select id,name,status from draft.drafts where id=$1',[REHEARSAL_ID])).rows[0];
 if(!d)return {exists:false,draft_id:REHEARSAL_ID};
 assert.equal(d.name,NAME,'Fixture identity mismatch');
 const checkpoints=(await db.query(`select c.id,c.revision,c.completed_rounds,c.terminal,r.object_key,r.sha256,r.uploaded_at
 from backup.draft_checkpoints c left join backup.receipts r on r.checkpoint_id=c.id
 where c.draft_id=$1 order by c.revision`,[REHEARSAL_ID])).rows;
 return {exists:true,draft_id:REHEARSAL_ID,status:d.status,checkpoints,
  all_uploaded:checkpoints.length===3&&checkpoints.every(c=>c.object_key&&/^[a-f0-9]{64}$/.test(c.sha256))};
}
export async function createCheckpointRehearsal(db){
 await db.query('begin');
 try{
  await db.query("set local lock_timeout='10s'");
  await db.query('select pg_advisory_xact_lock(731947,2)');
  const prior=await checkpointStatus(db);
  if(prior.exists){assert.equal(prior.status,'cancelled');assert.equal(prior.checkpoints.length,3);await db.query('rollback');return {...prior,already_created:true};}
  const owners=(await db.query("select id from draft.owners where active order by slug limit 2")).rows;
  assert.equal(owners.length,2,'Two active owners required');
  await db.query(`insert into draft.drafts(id,name,kind,championship_year,rounds,participant_count,pick_duration_seconds)
   values($1,$2,'free_agent',2027,2,2,60)`,[REHEARSAL_ID,NAME]);
  for(let i=0;i<2;i++)await db.query('insert into draft.draft_participants values($1,$2,$3)',[REHEARSAL_ID,owners[i].id,i+1]);
  await db.query('select draft.generate_snake_picks($1)',[REHEARSAL_ID]);
  await db.query(`insert into draft.draft_events(draft_id,event_type,payload) values($1,'backup_rehearsal',
   '{"synthetic":true,"scope":"Checkpoint/export test only; no player picks or roster changes"}')`,[REHEARSAL_ID]);
  // Flush deferred checkpoint events at each boundary inside ONE transaction.
  // No other session ever sees a running rehearsal or an expiring clock.
  await db.query("update draft.drafts set status='running',current_pick_number=1,deadline_at=clock_timestamp()+interval '1 hour',revision=1 where id=$1",[REHEARSAL_ID]);
  await db.query('set constraints all immediate');await db.query('set constraints all deferred');
  await db.query('update draft.draft_picks set skipped_at=clock_timestamp() where draft_id=$1 and round=1',[REHEARSAL_ID]);
  await db.query("insert into draft.draft_events(draft_id,event_type,payload) values($1,'backup_rehearsal_round','{\"round\":1,\"synthetic_skips\":2}')",[REHEARSAL_ID]);
  await db.query('update draft.drafts set current_pick_number=3,revision=2 where id=$1',[REHEARSAL_ID]);
  await db.query('set constraints all immediate');await db.query('set constraints all deferred');
  await db.query("update draft.drafts set status='cancelled',current_pick_number=null,deadline_at=null,revision=3 where id=$1",[REHEARSAL_ID]);
  await db.query('set constraints all immediate');
  const state=await checkpointStatus(db);
  assert.equal(state.checkpoints.length,3);assert.deepEqual(state.checkpoints[1].completed_rounds,[1]);assert.equal(state.checkpoints[2].terminal,true);
  await db.query('commit');return {...state,already_created:false};
 }catch(e){await db.query('rollback');throw e;}
}
