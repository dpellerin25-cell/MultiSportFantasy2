import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';

export const TEST_LEDGER={version:1,trades:[],purpose:'HTTP trade diagnostic only'};
export function settings(env){
  const names=['DRAFT_TEST_CONFIRM','DRAFT_TEST_DATABASE_URL','DRAFT_TEST_PUBLISHABLE_KEY',
    ...['DOUG','OWNER','THIRD'].flatMap(s=>[`DRAFT_TEST_${s}_EMAIL`,`DRAFT_TEST_${s}_PASSWORD`])];
  const missing=names.filter(n=>!env[n]);
  if(missing.length)throw new Error('Missing settings: '+missing.join(', '));
  if(env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('Test project confirmation required');
  return connectionConfig(env.DRAFT_TEST_DATABASE_URL);
}
export function httpApi(key,fetcher=fetch){
  const base=`https://${PROJECT}.supabase.co`;
  async function request(path,body,token,method='POST'){
    const r=await fetcher(base+path,{method,headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
    return {ok:r.ok,status:r.status,body:await r.json()};
  }
  return {
    async login(email,password){
      const r=await request('/auth/v1/token?grant_type=password',{email,password});assert.ok(r.ok,'Sign-in failed');
      const token=r.body.access_token;assert.ok(token);
      const u=await request('/auth/v1/user',null,token,'GET');assert.ok(u.ok,'User verification failed');
      assert.ok(u.body.id&&u.body.email_confirmed_at);assert.equal(u.body.email.toLowerCase(),email.toLowerCase());
      return {id:u.body.id,token};
    },
    rpc:(name,args,token)=>request('/rest/v1/rpc/'+name,args,token),
    // Read the raw table through its profile: it must not be accessible.
    async raw(token){
      const r=await fetcher(base+'/rest/v1/trades?select=id',{headers:{apikey:key,Authorization:`Bearer ${token}`,'Accept-Profile':'trading'},signal:AbortSignal.timeout(15000)});
      return {ok:r.ok,status:r.status};
    }
  };
}

export async function prepare(db,users,run){
  await db.query('begin');
  try{
    await db.query('select pg_advisory_xact_lock(731943,1)');
    const mapping=(await db.query('select o.id,o.slug,o.active,m.auth_user_id,exists(select 1 from draft.league_roles r where r.auth_user_id=m.auth_user_id) privileged from draft.owners o left join draft.owner_accounts m on m.owner_id=o.id')).rows;
    assert.equal(new Set(users.map(u=>u.id)).size,3,'Three different accounts required');
    const members=users.map(u=>mapping.find(m=>m.auth_user_id===u.id&&m.active));
    assert.ok(members.every(Boolean),'Each test user must have an active owner link');
    assert.equal(members[0].slug,'doug');assert.equal(members[1].slug,'chris');
    assert.ok(members[0].privileged&&!members[1].privileged&&!members[2].privileged,'Only Doug should be commissioner');
    const ledger=(await db.query('select ledger from trading.ledger_import')).rows;
    if(ledger.length)assert.deepEqual(ledger[0].ledger,TEST_LEDGER,'Existing non-test ledger; refusing fixture setup');
    else{
      for(const table of ['picks','trades','players','roster_snapshots','notifications','requests'])
        assert.equal((await db.query(`select count(*)::int n from trading.${table}`)).rows[0].n,0,'Trade schema must be unused');
      await db.query('select trading.import_pick_ledger($1)',[JSON.stringify(TEST_LEDGER)]);
    }
    // Retained history is allowed only for this diagnostic, with completed cleanup.
    const previous=(await db.query('select message,status,corrected_at from trading.trades')).rows;
    assert.ok(previous.every(t=>/^HTTP trade test [0-9a-f-]{36}$/.test(t.message)&&['countered','declined','withdrawn','expired','invalidated','completed'].includes(t.status)&&(t.status!=='completed'||t.corrected_at)),
      'Existing trade requires attention; run cleanup for its run ID first');
    assert.equal((await db.query('select count(*)::int n from trading.picks where owner_id<>original_owner_id')).rows[0].n,0,'Picks must be restored before testing');
    assert.equal((await db.query('select count(*)::int n from trading.players')).rows[0].n,0,'This diagnostic requires no imported player rosters');
    const picks=[];
    for(const m of members)picks.push((await db.query("select id from trading.picks where owner_id=$1 and year=extract(year from clock_timestamp() at time zone 'UTC')::int+1 order by round limit 1",[m.id])).rows[0]?.id);
    assert.ok(picks.every(Boolean));await db.query('commit');
    return {owners:members.map(m=>m.id),picks,message:'HTTP trade test '+run};
  }catch(e){await db.query('rollback');throw e;}
}

// Preserve immutable audit history. Close offers, reverse accepted pick transfers,
// and suppress this run's queued notifications. Never disable constraints/triggers.
export async function cleanup(db,doug,run){
  assert.match(run,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  await db.query('begin');
  try{
    await db.query('select pg_advisory_xact_lock(731943,1)');
    assert.deepEqual((await db.query('select ledger from trading.ledger_import')).rows[0]?.ledger,TEST_LEDGER);
    const trades=(await db.query('select * from trading.trades where message=$1 order by created_at desc',['HTTP trade test '+run])).rows;
    for(const t of trades){
      // Fixtures contain picks only; refuse to reverse any unexpected player trade.
      assert.equal((await db.query('select count(*)::int n from trading.assets where trade_id=$1 and player_id is not null',[t.id])).rows[0].n,0);
      if(t.status==='proposed'){
        if(Date.parse(t.expires_at)<=Date.now()){
          await db.query("update trading.trades set status='expired',revision=revision+1 where id=$1",[t.id]);
          await db.query("insert into trading.events(trade_id,action) values($1,'expired')",[t.id]);continue;
        }
        const proposer=(await db.query('select auth_user_id from draft.owner_accounts where owner_id=$1',[t.proposer_id])).rows[0]?.auth_user_id;
        assert.ok(proposer);await db.query("select set_config('request.jwt.claim.sub',$1,true)",[proposer]);
        await db.query('select public.trade_command($1,\'withdraw\',$2)',[randomUUID(),JSON.stringify({trade_id:t.id,revision:t.revision})]);
      }else if(['accepted','completed'].includes(t.status)&&!t.corrected_at){
        await db.query("select set_config('request.jwt.claim.sub',$1,true)",[doug]);
        await db.query('select public.trade_command($1,\'correct\',$2)',[randomUUID(),JSON.stringify({trade_id:t.id,revision:t.revision,reason:'HTTP diagnostic cleanup '+run})]);
      }
    }
    await db.query("update trading.notifications n set status='failed',next_attempt_at='infinity' from trading.events e join trading.trades t on t.id=e.trade_id where n.event_id=e.id and t.message=$1 and n.status in ('pending','failed')",['HTTP trade test '+run]);
    await db.query('commit');return trades.length;
  }catch(e){await db.query('rollback');throw e;}
}

export async function scenario(api,users,fixture,report=console.log){
  const {owners,picks,message}=fixture;
  const call=(i,name,args)=>api.rpc(name,args,users[i].token);
  const ok=async(i,name,args)=>{const r=await call(i,name,args);assert.ok(r.ok,'HTTP request failed');return r.body;};
  const list=i=>ok(i,'trade_list',{});
  const command=(i,action,args,request_id=randomUUID())=>ok(i,'trade_command',{request_id,action,args});
  const propose=()=>command(0,'propose',{recipient_id:owners[1],message,assets:[{from_owner_id:owners[0],pick_id:picks[0]}]});
  for(const token of [null,'invalid.jwt.token']){
    const r=await api.rpc('trade_list',{},token);assert.ok([401,403].includes(r.status));
    const w=await api.rpc('trade_command',{request_id:randomUUID(),action:'propose',args:{}},token);assert.ok([401,403].includes(w.status));
  }
  for(const u of users){const r=await api.raw(u.token);assert.ok([400,401,403,404,406].includes(r.status)&&!r.ok);}
  report('PASS HTTP anonymous/forged token denial and blocked raw table reads');
  const t=await propose();
  for(const i of [0,1])assert.ok((await list(i)).some(x=>x.id===t.trade_id));
  assert.ok(!(await list(2)).some(x=>x.id===t.trade_id));
  const denied=await call(2,'trade_command',{request_id:randomUUID(),action:'accept',args:{trade_id:t.trade_id,revision:t.revision}});
  assert.equal(denied.status,403);
  report('PASS HTTP proposal visible only to involved owners; unrelated owner cannot accept');
  const args={trade_id:t.trade_id,revision:t.revision},request=randomUUID();
  const accepted=await command(1,'accept',args,request);assert.equal(accepted.status,'completed');
  assert.deepEqual(await command(1,'accept',args,request),accepted);
  const visible=(await list(2)).find(x=>x.id===t.trade_id);assert.ok(visible);assert.equal(visible.message,null);
  const correction={trade_id:t.trade_id,revision:accepted.revision,reason:'HTTP fixture reversal'};
  assert.equal((await call(1,'trade_command',{request_id:randomUUID(),action:'correct',args:correction})).status,403);
  await command(0,'correct',correction);
  report('PASS HTTP acceptance/retry, league visibility, private message protection and commissioner reversal');
  const next=await propose();
  const counter=await command(1,'counter',{trade_id:next.trade_id,revision:next.revision,recipient_id:owners[0],message,assets:[{from_owner_id:owners[0],pick_id:picks[0]}]});
  const declined=await command(0,'decline',{trade_id:counter.trade_id,revision:counter.revision});assert.equal(declined.status,'declined');
  const privateTrade=await command(1,'propose',{recipient_id:owners[2],message,assets:[{from_owner_id:owners[2],pick_id:picks[2]}]});
  assert.ok(!(await list(0)).some(x=>x.id===privateTrade.trade_id));
  await command(1,'withdraw',{trade_id:privateTrade.trade_id,revision:privateTrade.revision});
  report('PASS HTTP counter/decline/withdrawal and commissioner excluded from private negotiations');
  return t.trade_id;
}
