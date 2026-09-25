import assert from 'node:assert/strict';

export const OWNER_SLUGS=['brendan','chris','doug','hatch','jack','jacob','nik','ryan','tucker'];
const MINIMUMS={NFL:9,NBA:8,MLB:14,EPL:11,PGA:6};
export class SetupError extends Error {}
const check=(condition,message)=>{if(!condition)throw new SetupError(message);};
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function validateSetup(c){
  check(c&&uuid(c.draft_id)&&uuid(c.import_id),'Specify valid draft_id and import_id UUIDs');
  check(typeof c.name==='string'&&c.name.trim().length>0&&c.name.length<=120,'Draft name required (1–120 characters)');
  check(Number.isInteger(c.championship_year)&&c.championship_year>=2027,'Championship year must be 2027 or later');
  check(Number.isInteger(c.timer_seconds)&&c.timer_seconds>=1&&c.timer_seconds<=86400,'Choose timer_seconds from 1 to 86400');
  check(Array.isArray(c.owner_order)&&c.owner_order.length===9&&[...c.owner_order].sort().join()===OWNER_SLUGS.join(),'owner_order must contain each of the nine owner slugs exactly once');
  check(Object.keys(c).sort().join()===['draft_id','import_id','name','championship_year','timer_seconds','owner_order'].sort().join(),'Unexpected configuration fields');
  return {...c,draft_id:c.draft_id.toLowerCase(),import_id:c.import_id.toLowerCase(),owner_order:[...c.owner_order]};
}
export function snakePreview(order){
  return Array.from({length:585},(_,i)=>{const round=Math.floor(i/9)+1,position=i%9;return {round,pick_number:i+1,owner:order[round%2?position:8-position]};});
}

// Trusted administrator setup only; no impersonation, auth grants or start action.
// Identical retries reuse a UUID. Different settings require a new explicit setup
// workflow instead of silently overwriting a potentially active draft.
export async function prepareDraft(db,input,{create=false}={}){
  const c=validateSetup(input),q=async(s,p=[])=>(await db.query(s,p)).rows;
  await q(create?'begin':'begin read only');
  try{
    await q("set local statement_timeout='60s'");await q("set local lock_timeout='10s'");
    if(create)await q('select pg_advisory_xact_lock(20260925,2)');
    const owners=await q('select id,slug from draft.owners where active order by slug');
    check(owners.map(o=>o.slug).join()===OWNER_SLUGS.join(),'Active owners do not match the nine league owners');
    const imp=(await q('select * from draft.player_pool_imports where id=$1',[c.import_id]))[0];
    check(imp?.status==='ready'&&imp.metadata?.validator==='fantrax-export-v1','Select a finalized validated Fantrax import');
    const counts=await q("select sport,count(*)::int total,count(*) filter(where availability not in ('free_agent','waivers'))::int invalid from draft.player_pool_entries where import_id=$1 group by sport",[c.import_id]);
    check(counts.length===5,'Import must include all five sports');
    for(const [sport,min] of Object.entries(MINIMUMS)){
      const row=counts.find(r=>r.sport===sport);
      check(row&&row.invalid===0&&row.total===imp.metadata.sports?.[sport]?.total&&row.total>=9*min,`${sport}: snapshot count/eligibility/minimum check failed`);
    }
    const total=counts.reduce((n,r)=>n+r.total,0);
    check(total===imp.metadata.total_players&&total>=585,'Snapshot total mismatch or fewer than 585 eligible players');
    const existing=(await q('select * from draft.drafts where id=$1'+(create?' for update':''),[c.draft_id]))[0];
    if(existing){
      check(existing.status==='setup'&&existing.current_pick_number===null&&existing.deadline_at===null,'Draft has already started or has clock state');
      check(existing.name===c.name&&existing.import_id===c.import_id&&existing.championship_year===c.championship_year&&existing.pick_duration_seconds===c.timer_seconds&&existing.kind==='startup'&&existing.rounds===65&&existing.participant_count===9,'Draft ID already exists with different settings');
      const order=await q('select o.slug from draft.draft_participants p join draft.owners o on o.id=p.owner_id where p.draft_id=$1 order by p.order_position',[c.draft_id]);
      check(order.map(o=>o.slug).join()===c.owner_order.join(),'Existing draft order differs');
      check(Number((await q('select count(*) n from draft.draft_picks where draft_id=$1',[c.draft_id]))[0].n)===0,'Existing draft already has pick slots');
      const differences=await q(`select 1 from (
        (select player_id,sport,name,position,professional_team,availability from draft.player_pool_entries where import_id=$2 except select player_id,sport,name,position,professional_team,availability from draft.draft_pool_players where draft_id=$1 and eligible)
        union all
        (select player_id,sport,name,position,professional_team,availability from draft.draft_pool_players where draft_id=$1 except select player_id,sport,name,position,professional_team,availability from draft.player_pool_entries where import_id=$2)
      ) mismatch limit 1`,[c.draft_id,c.import_id]);
      check(differences.length===0,'Existing draft pool differs from snapshot');
    }else if(create){
      await q("insert into draft.drafts(id,name,kind,championship_year,rounds,participant_count,import_id,pick_duration_seconds) values($1,$2,'startup',$3,65,9,$4,$5)",[c.draft_id,c.name,c.championship_year,c.import_id,c.timer_seconds]);
      for(let i=0;i<9;i++)await q('insert into draft.draft_participants values($1,$2,$3)',[c.draft_id,owners.find(o=>o.slug===c.owner_order[i]).id,i+1]);
      await q('insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,position,professional_team,availability,eligible) select $1,import_id,player_id,sport,name,position,professional_team,availability,true from draft.player_pool_entries where import_id=$2',[c.draft_id,c.import_id]);
      await q("insert into draft.draft_events(draft_id,event_type,payload) values($1,'admin_setup',$2)",[c.draft_id,JSON.stringify({tool:'test-project-draft-setup',configuration:c,actor_scope:'Privileged SQL administrator; no authenticated owner asserted'})]);
    }
    if(existing||create){
      const rules=await q('select sport,minimum,maximum from draft.draft_sport_rules where draft_id=$1',[c.draft_id]);
      check(rules.length===5&&rules.every(r=>r.minimum===MINIMUMS[r.sport]&&r.maximum===null),'Startup roster rules differ');
    }
    const preview=snakePreview(c.owner_order);
    assert.equal(preview.length,585);
    await q(create?'commit':'rollback');
    return {draft_id:c.draft_id,import_id:c.import_id,mode:create?'create':'read-only preview',already_exists:!!existing,status:'setup',started:false,rounds:65,scheduled_picks:585,persisted_pick_slots:0,timer_seconds:c.timer_seconds,owner_order:c.owner_order,minimums:MINIMUMS,sport_maximums:null,pool_players:total,pool_completed_at:imp.metadata.completed_at,sports:counts.map(({sport,total})=>({sport,total})),first_two_rounds:preview.slice(0,18),last_round:preview.slice(-9)};
  }catch(e){await q('rollback');throw e;}
}
