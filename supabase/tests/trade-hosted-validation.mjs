import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Only fixed, credential-free setup messages may be printed by the hosted CLI.
export class TradeSetupError extends Error {}
function requireSetup(ok,message){if(!ok)throw new TradeSetupError(message);}

// Caller MUST wrap this in a transaction and ROLLBACK even on success.
// Existing linked accounts only. No new accounts or role grants.
export async function validateHostedTrades(db,doug,chris,report=console.log){
  const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const value=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
  const owners=Object.fromEntries((await q('select slug,id from draft.owners where active')).map(o=>[o.slug,o.id]));
  requireSetup(Object.keys(owners).length===9,'Expected nine active owners in the test project.');
  requireSetup(doug!==chris,'Doug and Chris settings signed into the same account. Use two different test accounts.');
  for(const [user,slug] of [[doug,'doug'],[chris,'chris']])
    requireSetup((await q('select owner_id from draft.owner_accounts where auth_user_id=$1',[user]))[0]?.owner_id===owners[slug],
      slug==='doug'?'Doug test credentials are not linked to the Doug owner.':'OWNER test credentials are not linked to the Chris owner.');
  requireSetup(await value("select exists(select 1 from draft.league_roles where auth_user_id=$1 and role='commissioner')",[doug]),'Doug test account needs its existing commissioner role.');
  requireSetup(!await value("select exists(select 1 from draft.league_roles where auth_user_id=$1 and role='commissioner')",[chris]),'Chris test account has a commissioner role; this test requires a non-commissioner Chris account.');
  const third=(await q('select m.auth_user_id,m.owner_id from draft.owner_accounts m join draft.owners o on o.id=m.owner_id where o.active and m.auth_user_id<>all($1::uuid[]) limit 1',[[doug,chris]]))[0];
  requireSetup(third,'No third linked active owner was found. Link one additional test account to an owner other than Doug or Chris. No third password is needed for this test.');
  await q('select pg_advisory_xact_lock(731943,1)');
  // Never operate alongside real or earlier committed trade fixtures.
  for(const table of ['trades','picks','ledger_import','players','roster_snapshots','notifications','requests'])
    requireSetup(await value(`select count(*)::int from trading.${table}`)===0,`Trade schema must be unused: trading.${table} already contains rows. Do not delete existing data to run this test.`);
  await q(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
  async function as(user,role,fn){
    await q('savepoint trade_permission');
    try{
      await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[user??'',JSON.stringify({sub:user,role})]);
      await q(role==='anon'?'set local role anon':'set local role authenticated');
      const result=await fn();await q('reset role');await q('release savepoint trade_permission');return result;
    }catch(e){await q('rollback to savepoint trade_permission');await q('release savepoint trade_permission');throw e;}
  }
  const command=(user,action,args,request=randomUUID())=>as(user,'authenticated',()=>value('select public.trade_command($1,$2,$3)',[request,action,JSON.stringify(args)]));
  const list=user=>as(user,'authenticated',()=>value('select public.trade_list()'));
  const pick=await value("select id from trading.picks where owner_id=$1 order by year,round limit 1",[owners.doug]);
  const t=await command(doug,'propose',{recipient_id:owners.chris,message:'Private rollback-only test',assets:[{from_owner_id:owners.doug,pick_id:pick}]});
  assert.ok((await list(doug)).some(x=>x.id===t.trade_id));assert.ok((await list(chris)).some(x=>x.id===t.trade_id));
  assert.equal((await list(third.auth_user_id)).length,0);
  await assert.rejects(()=>command(third.auth_user_id,'accept',{trade_id:t.trade_id,revision:0}),/not permitted/);
  report('PASS hosted SQL roles: linked identities, private proposal, other-owner denial');
  const request=randomUUID(),args={trade_id:t.trade_id,revision:t.revision};
  const accepted=await command(chris,'accept',args,request);
  assert.equal(accepted.status,'completed');assert.deepEqual(await command(chris,'accept',args,request),accepted);
  assert.equal(await value('select owner_id from trading.picks where id=$1',[pick]),owners.chris);
  assert.equal(await value('select count(*)::int from trading.pick_history where pick_id=$1',[pick]),1);
  assert.equal(await value("select count(*)::int from trading.notifications n join trading.events e on e.id=n.event_id where e.trade_id=$1 and n.kind='acceptance'",[t.trade_id]),await value('select count(*)::int from draft.owner_accounts a join draft.owners o on o.id=a.owner_id where o.active'));
  const visible=(await list(third.auth_user_id)).find(x=>x.id===t.trade_id);assert.equal(visible.message,null);
  await assert.rejects(()=>command(chris,'correct',{trade_id:t.trade_id,revision:accepted.revision,reason:'Denied'}),/Commissioner/);
  await command(doug,'correct',{trade_id:t.trade_id,revision:accepted.revision,reason:'Rollback-only test reversal'});
  assert.equal(await value('select owner_id from trading.picks where id=$1',[pick]),owners.doug);
  report('PASS hosted SQL roles: acceptance, retry, notification deduplication, league visibility and commissioner reversal');
  const second=await command(doug,'propose',{recipient_id:owners.chris,assets:[{from_owner_id:owners.doug,pick_id:pick}]});
  const counter=await command(chris,'counter',{trade_id:second.trade_id,revision:0,recipient_id:owners.doug,assets:[{from_owner_id:owners.doug,pick_id:pick}]});
  await command(doug,'decline',{trade_id:counter.trade_id,revision:0});
  assert.equal(await value('select status from trading.trades where id=$1',[second.trade_id]),'countered');
  assert.equal(await value('select status from trading.trades where id=$1',[counter.trade_id]),'declined');
  // Doug has no special access to private negotiations between other owners.
  await command(chris,'propose',{recipient_id:third.owner_id,assets:[{from_owner_id:third.owner_id,pick_id:await value('select id from trading.picks where owner_id=$1 limit 1',[third.owner_id])}]});
  assert.equal((await list(doug)).length,3);
  for(const sql of ['select * from trading.trades','select * from trading.notifications','select trading.expire_offers()',"update trading.picks set owner_id=owner_id"])
    await assert.rejects(()=>as(doug,'authenticated',()=>q(sql)),/permission denied/);
  await assert.rejects(()=>as(null,'anon',()=>q('select public.trade_list()')),/permission denied/);
  await assert.rejects(()=>list(randomUUID()),/Owner account required/);
  report('PASS hosted SQL roles: counter/decline, commissioner privacy, raw-table/helper/anonymous/outsider denial');
}
