import {createHash} from 'node:crypto';
export async function attachProspects(db,target,{approval,bindings={}}={}){
 await db.query('begin');
 try{
  await db.query("set local lock_timeout='10s'");
  await db.query('select pg_advisory_xact_lock(731943,1)');
  const d=(await db.query('select * from draft.drafts where id=$1 for update',[target])).rows[0];
  if(!d)throw Error('Draft not found');
  const catalogue=(await db.query('select * from draft.prospect_catalog order by id')).rows;
  // Include the whole input pool and revision, not only the row count.
  const pool=(await db.query('select * from draft.draft_pool_players where draft_id=$1 order by player_id',[target])).rows;
  const hash=createHash('sha256').update(JSON.stringify({d,catalogue,pool,bindings})).digest('hex');
  if(approval&&approval!==hash)throw Error('Preview changed; run preview again');
  const result=(await db.query('select draft.attach_startup_prospects($1,$2) r',[target,bindings])).rows[0].r;
  await db.query(approval?'commit':'rollback');
  return {draft_id:target,applied:!!approval,approval_hash:hash,...result};
 }catch(e){await db.query('rollback');throw e;}
}
