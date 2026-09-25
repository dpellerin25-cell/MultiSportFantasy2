export async function linkTestAccounts(db,doug,owner,{apply=false}={}){
  if(!doug||!owner||doug===owner)throw new Error('Two distinct verified accounts required');
  const q=async(s,p=[])=>(await db.query(s,p)).rows;
  await q('begin');
  try{
    await q("set local lock_timeout='10s'");
    await q('select pg_advisory_xact_lock(20260926,1)');
    const owners=await q("select id,slug from draft.owners where slug in ('doug','chris') and active order by slug for update");
    if(owners.length!==2)throw new Error('Expected active Doug and Chris owners');
    for(const [slug,id] of [['doug',doug],['chris',owner]]){
      const ownerId=owners.find(o=>o.slug===slug).id;
      if(!(await q('select id from auth.users where id=$1',[id])).length)throw new Error('Verified account missing in target database');
      const existing=await q('select * from draft.owner_accounts where auth_user_id=$1 or owner_id=$2',[id,ownerId]);
      if(existing.some(r=>r.auth_user_id!==id||r.owner_id!==ownerId))throw new Error('Conflicting existing account mapping; no changes made');
      if(slug==='chris'&&(await q('select 1 from draft.league_roles where auth_user_id=$1',[id])).length)throw new Error('Other account already privileged; select an ordinary test account');
      if(!existing.length)await q('insert into draft.owner_accounts values($1,$2)',[id,ownerId]);
    }
    await q("insert into draft.league_roles values($1,'commissioner') on conflict do nothing",[doug]);
    await q(apply?'commit':'rollback');
    return {applied:apply,links:[{owner:'doug',auth_user_id:doug,commissioner:true},{owner:'chris',auth_user_id:owner,commissioner:false}]};
  }catch(e){await q('rollback');throw e;}
}
