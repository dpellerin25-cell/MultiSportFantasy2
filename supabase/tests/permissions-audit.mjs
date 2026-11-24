import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Caller must own a READ ONLY transaction. Never run commissioner mutations.
export async function auditPermissions(db, {expectedOwners=11}={}) {
  const q=async(s,p=[])=>(await db.query(s,p)).rows;
  assert.equal((await q('show transaction_read_only'))[0].transaction_read_only,'on');
  const owners=await q(`select o.id,o.slug,a.auth_user_id from draft.owners o
    left join draft.owner_accounts a on a.owner_id=o.id where o.active order by o.slug`);
  assert.equal(owners.length,expectedOwners,'Unexpected active owner count');
  assert.ok(owners.every(o=>o.auth_user_id),'Every active owner must be linked');
  const roles=await q("select auth_user_id from draft.league_roles where role='commissioner'");
  assert.deepEqual(roles.map(r=>r.auth_user_id),[owners.find(o=>o.slug==='doug')?.auth_user_id],'Doug must be the sole commissioner');
  const privateTables=['draft.owner_accounts','draft.league_roles','draft.draft_commands',
    'trading.trades','trading.prospects','scoring.results','scoring.pause_events'];
  const adminReads=['public.league_settings_state()','public.owner_invitation_state()',
    'public.prospect_admin()','public.scoring_controls_state()'];
  const deniedCommands=[
    ["select public.prospect_command($1,'add','{}'::jsonb)",[randomUUID()]],
    ["select public.prepare_owner_invitation($1,$2,'audit@example.invalid',true)",[randomUUID(),owners[0].id]],
    ["select public.scoring_controls_pause($1,true,'Permission audit',0,true)",[randomUUID()]],
    ["select public.scoring_controls_pga_review($1)",[randomUUID()]],
    ["select public.scoring_controls_pga_resolve($1,$2,'waive','Permission audit','[]'::jsonb,null,true)",[randomUUID(),randomUUID()]],
    ["select public.league_settings_apply($1,2027,'[]'::jsonb,array[0]::numeric[],'invalid')",[randomUUID()]],
  ];
  async function as(who,role,sql,params=[]) {
    await q('savepoint permission_probe');
    try {
      await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",
        [who??'',JSON.stringify({sub:who,role})]);
      await q(role==='anon'?'set local role anon':'set local role authenticated');
      assert.equal((await q('select auth.uid() id'))[0].id,who);
      return await q(sql,params);
    } finally {
      await q('rollback to savepoint permission_probe');
      await q('release savepoint permission_probe');
    }
  }
  // A read-only error or invalid argument is NOT proof of authorization denial.
  const denied=async(who,role,sql,params=[])=>assert.rejects(()=>as(who,role,sql,params),
    e=>e.code==='42501'||(e.code==='P0001'&&/commissioner/i.test(e.message)));
  const results=[];
  for(const owner of owners){
    const who=owner.auth_user_id;
    const roster=(await as(who,'authenticated','select public.trade_rosters() result'))[0].result;
    assert.equal(roster.viewer_owner_id,owner.id,'Roster identity mismatch');
    const trades=(await as(who,'authenticated','select public.trade_list() result'))[0].result;
    assert.ok(Array.isArray(trades));
    for(const trade of trades){
      if(![trade.proposer_id,trade.recipient_id].includes(owner.id)){
        assert.ok(trade.accepted_at,'Private trade exposed to unrelated owner');
        assert.equal(trade.message,null,'Private trade message exposed');
      }
    }
    assert.equal((await as(who,'authenticated','select public.prospect_owner() id'))[0].id,owner.id);
    for(const table of privateTables){
      try {assert.equal((await as(who,'authenticated',`select count(*)::int n from ${table}`))[0].n,0);}
      catch(e){if(e.code!=='42501')throw e;}
      for(const privilege of ['INSERT','UPDATE','DELETE']){
        assert.equal((await q('select has_table_privilege(\'authenticated\',$1,$2) allowed',[table,privilege]))[0].allowed,false);
      }
    }
    for(const fn of adminReads){
      if(owner.slug==='doug')await as(who,'authenticated',`select ${fn}`);
      else await denied(who,'authenticated',`select ${fn}`);
    }
    if(owner.slug!=='doug')for(const [sql,params] of deniedCommands)await denied(who,'authenticated',sql,params);
    results.push({owner:owner.slug,status:'verified',scope:owner.slug==='doug'?'linked identity, private table protection, commissioner reads':'linked identity, private table protection, commissioner reads/actions denied'});
  }
  for(const [who,role] of [[randomUUID(),'authenticated'],[null,'anon']]){
    await denied(who,role,'select public.trade_list()');
    for(const fn of adminReads)await denied(who,role,`select ${fn}`);
    for(const [sql,params] of deniedCommands)await denied(who,role,sql,params);
  }
  return {results,outsider_and_anonymous:'verified',changes_committed:false,
    not_yet_verified:['Real account sign-in and HTTP RPC authorization','Commissioner write success on hosted fixtures','Browser visibility and Realtime delivery']};
}
