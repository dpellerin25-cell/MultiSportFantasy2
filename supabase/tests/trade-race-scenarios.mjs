// Shared assertions. Only the pg runner can prove independent sessions/lock waits.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function tradeRaceScenarios({admin,race,report}){
  const scalar=async(c,sql,p=[])=>Object.values((await c.query(sql,p)).rows[0])[0];
  const owners=Object.fromEntries((await admin.query('select slug,id from draft.owners')).rows.map(o=>[o.slug,o.id]));
  const users=Object.fromEntries(Object.keys(owners).map(s=>[s,randomUUID()]));
  for(const [s,u] of Object.entries(users)){
    await admin.query('insert into auth.users values($1)',[u]);
    await admin.query('insert into draft.owner_accounts values($1,$2)',[u,owners[s]]);
  }
  await admin.query("insert into draft.league_roles values($1,'commissioner')",[users.doug]);
  await admin.query(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
  const cmd=(owner,action,args,request=randomUUID())=>async c=>{
    await c.query("select set_config('request.jwt.claim.sub',$1,true)",[users[owner]]);
    await c.query('set local role authenticated');
    return scalar(c,'select public.trade_command($1,$2,$3)',[request,action,JSON.stringify(args)]);
  };
  const run=async op=>{
    await admin.query('begin');
    try{const result=await op(admin);await admin.query('commit');return result;}
    catch(e){await admin.query('rollback');throw e;}
  };
  let round=0;
  const nextPick=async()=>{
    const n=round++;
    return scalar(admin,"select id from trading.picks where original_owner_id=$1 and round=$2 and year=extract(year from clock_timestamp() at time zone 'UTC')::int+$3",
      [owners.doug,(n%10)+1,Math.floor(n/10)+1]);
  };
  const pa=id=>({from_owner_id:owners.doug,pick_id:id});
  const propose=(assets,to='chris')=>run(cmd('doug','propose',{recipient_id:owners[to],assets}));
  const action=(owner,verb,t,extra={})=>cmd(owner,verb,{trade_id:t.trade_id,revision:t.revision,...extra});
  const status=id=>scalar(admin,'select status from trading.trades where id=$1',[id]);
  const count=(table,where,p=[])=>scalar(admin,`select count(*)::int from trading.${table} where ${where}`,p);
  const failed=(outcome,pattern=/Offer changed|closed|ownership changed/)=>assert.match(outcome.error?.message??'',pattern);
  const success=outcome=>{assert.ifError(outcome.error);return outcome.value;};
  const events=t=>count('events',"trade_id=$1 and action='accept'",[t.trade_id]);
  const history=p=>count('pick_history','pick_id=$1',[p]);

  {
    const p=await nextPick(),t=await propose([pa(p)]);
    const {second}=await race(action('chris','accept',t),action('chris','accept',t));
    failed(second);assert.equal(await history(p),1);assert.equal(await events(t),1);
    assert.equal(await status(t.trade_id),'completed');
    report('same offer accepted twice: one transfer and one acceptance event');
  }
  {
    const p=await nextPick(),t=await propose([pa(p)]),request=randomUUID();
    const op=cmd('chris','accept',{trade_id:t.trade_id,revision:t.revision},request);
    const {first,second}=await race(op,op);
    assert.deepEqual(success(second),first);
    assert.deepEqual(await run(op),first);
    assert.equal(await history(p),1);assert.equal(await events(t),1);
    assert.equal(await scalar(admin,"select count(*)::int from trading.notifications n join trading.events e on e.id=n.event_id where e.trade_id=$1 and n.kind='acceptance'",[t.trade_id]),(await admin.query('select count(*)::int n from draft.owner_accounts a join draft.owners o on o.id=a.owner_id where o.active')).rows[0].n);
    report('simultaneous identical retry: one transfer, one event, two recipient notification rows');
  }
  {
    const p=await nextPick(),one=await propose([pa(p)]),two=await propose([pa(p)],'jack');
    const {second}=await race(action('chris','accept',one),action('jack','accept',two));
    failed(second);assert.equal(await history(p),1);assert.equal(await status(two.trade_id),'invalidated');
    assert.equal(await scalar(admin,'select owner_id from trading.picks where id=$1',[p]),owners.chris);
    report('competing pick offers: first acceptance invalidates the other');
  }
  for(const verb of ['counter','withdraw'])for(const acceptanceFirst of [true,false]){
    const p=await nextPick(),t=await propose([pa(p)]);
    const other=verb==='counter'?action('chris','counter',t,{recipient_id:owners.doug,assets:[pa(p)]}):action('doug','withdraw',t);
    const accept=action('chris','accept',t);
    const {second}=await race(acceptanceFirst?accept:other,acceptanceFirst?other:accept);
    failed(second);
    assert.equal(await history(p),acceptanceFirst?1:0);
    assert.equal(await status(t.trade_id),acceptanceFirst?'completed':verb==='counter'?'countered':'withdrawn');
    report(`accept vs ${verb}, ${acceptanceFirst?'accept':'other command'} first: one outcome`);
  }
  const expireFixture=t=>admin.query("update trading.trades set created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 second' where id=$1",[t.trade_id]);
  {
    const t=await propose([pa(await nextPick())]);await expireFixture(t);
    const {second}=await race(c=>scalar(c,'select trading.expire_offers()'),action('chris','accept',t));
    failed(second);assert.equal(await status(t.trade_id),'expired');assert.equal(await events(t),0);
    report('expiry worker vs acceptance: expired offer cannot transfer assets');
  }
  {
    const t=await propose([pa(await nextPick())]);
    const {second}=await race(c=>c.query('select pg_advisory_xact_lock(731943,1)'),action('chris','accept',t),()=>expireFixture(t));
    failed(second,/expired/);assert.equal(await events(t),0);
    report('offer expires while acceptance waits: deadline rechecked after lock acquisition');
  }
  {
    const t=await propose([pa(await nextPick())]);
    const {second}=await race(action('chris','accept',t),c=>scalar(c,'select trading.expire_offers()'));
    success(second);assert.equal(await status(t.trade_id),'completed');assert.equal(await events(t),1);
    report('accepted trade is not subsequently expired by worker');
  }

  // Retain every fixture player in each full snapshot, avoiding accidental omissions.
  const rosterPlayers=new Map();let number=0;
  const payload=()=>Object.keys(owners).map(owner=>({owner,players:[...rosterPlayers].filter(([,o])=>o===owner).map(([id])=>({player_id:id,name:'Race '+id}))}));
  const ingest=c=>scalar(c,"select trading.ingest_rosters('NFL','trade-race-nfl',clock_timestamp(),$1)",[JSON.stringify(payload())]);
  const newPlayer=async()=>{
    const external='00'+(++number);rosterPlayers.set(external,'doug');await run(ingest);
    const id=await scalar(admin,'select id from trading.players where fantrax_id=$1',[external]);
    return {external,id,asset:{from_owner_id:owners.doug,player_id:id}};
  };
  {
    const p=await newPlayer(),one=await propose([p.asset]),two=await propose([p.asset],'jack');
    const {second}=await race(action('chris','accept',one),action('jack','accept',two));
    failed(second);assert.equal(await status(two.trade_id),'invalidated');
    assert.equal(await count('player_reservations','player_id=$1',[p.id]),1);
    assert.equal(await events(one),1);assert.equal(await events(two),0);
    report('competing player offers: one reservation, loser invalidated');
  }
  for(const importFirst of [true,false]){
    const p=await newPlayer(),t=await propose([p.asset]);rosterPlayers.set(p.external,'chris');
    const {second}=await race(importFirst?ingest:action('chris','accept',t),importFirst?action('chris','accept',t):ingest);
    if(importFirst){failed(second);assert.equal(await status(t.trade_id),'invalidated');}
    else{success(second);assert.equal(await status(t.trade_id),'completed');}
    assert.equal(await count('player_reservations','player_id=$1',[p.id]),0);
    report(`roster refresh vs acceptance, ${importFirst?'refresh':'acceptance'} first: consistent ownership`);
  }
  for(const correctionFirst of [true,false]){
    const p=await nextPick(),old=await propose([pa(p)]),accepted=await run(action('chris','accept',old));
    const onward=await run(cmd('chris','propose',{recipient_id:owners.jack,assets:[{from_owner_id:owners.chris,pick_id:p}]}));
    const correct=action('doug','correct',accepted,{reason:'Race fixture correction'}),accept=action('jack','accept',onward);
    const {second}=await race(correctionFirst?correct:accept,correctionFirst?accept:correct);
    failed(second);
    assert.equal(await history(p),2);
    assert.equal(await scalar(admin,'select owner_id from trading.picks where id=$1',[p]),correctionFirst?owners.doug:owners.jack);
    report(`correction vs onward acceptance, ${correctionFirst?'correction':'acceptance'} first: no overwritten ownership`);
  }
  for(const correctionFirst of [true,false]){
    const p=await newPlayer(),t=await propose([p.asset]),accepted=await run(action('chris','accept',t));
    rosterPlayers.set(p.external,'chris');
    const correct=action('doug','correct',accepted,{reason:'Reverse pending player transfer'});
    const {second}=await race(correctionFirst?correct:ingest,correctionFirst?ingest:correct);
    if(correctionFirst){
      success(second);assert.equal(await status(t.trade_id),'accepted');
      assert.equal(await count('player_reservations','player_id=$1',[p.id]),1);
      rosterPlayers.set(p.external,'doug');await run(ingest);
    }else{
      failed(second);assert.equal(await status(t.trade_id),'completed');
    }
    assert.equal(await status(t.trade_id),'completed');
    assert.equal(await count('player_reservations','player_id=$1',[p.id]),0);
    report(`Fantrax confirmation vs correction, ${correctionFirst?'correction':'confirmation'} first: correct revision and destination`);
  }
}
