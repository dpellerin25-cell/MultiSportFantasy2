// Dedicated disposable fixture. Never starts or edits the saved startup rehearsal.
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
let db,d,clients=[],channels=[],stage='settings';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<80;i++){if(await fn())return;await wait(500);}throw new Error('Timed out waiting for hosted signal/timer');}
async function rpc(client,name,args){const {data,error}=await client.rpc(name,args);if(error)throw error;return data;}
try{
  if(process.env.DRAFT_TEST_CONFIRM!==PROJECT)throw new Error('TEST confirmation required');
  db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));stage='database connection';await db.connect();
  stage='verifying active timer job';assert.ok((await db.query("select 1 from cron.job where jobname='multisport-draft-expiry' and active")).rowCount);
  const ids=[];
  for(const label of ['DOUG','OWNER']){
    const client=createClient(`https://${PROJECT}.supabase.co`,process.env.DRAFT_TEST_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});clients.push(client);
    stage='Auth '+label;const {data,error}=await client.auth.signInWithPassword({email:process.env[`DRAFT_TEST_${label}_EMAIL`],password:process.env[`DRAFT_TEST_${label}_PASSWORD`]});if(error)throw error;ids.push(data.user.id);
    await client.realtime.setAuth(data.session.access_token);
  }
  stage='checking fixture identities';
  const owners=(await db.query("select o.id,o.slug,a.auth_user_id from draft.owners o join draft.owner_accounts a on a.owner_id=o.id where o.slug in ('doug','chris') order by o.slug desc")).rows;
  assert.equal(owners[0]?.auth_user_id,ids[0]);assert.equal(owners[1]?.auth_user_id,ids[1]);
  stage='creating disposable live test fixture';await db.query('begin');
  const imp=(await db.query("insert into draft.player_pool_imports(checksum,schema_version) values($1,1) returning id",[randomUUID().replaceAll('-','').repeat(2)])).rows[0].id;
  d=(await db.query("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,import_id) values('Disposable realtime/timer test','free_agent',2027,2,2,$1) returning id",[imp])).rows[0].id;
  const players=[];
  for(let i=0;i<4;i++){
    const p=(await db.query("insert into draft.players(sport,name) values('NFL',$1) returning id",['Live test fixture '+i])).rows[0].id;
    const s=(await db.query("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'live-test',$2,$3) returning id",[p,d,String(i)])).rows[0].id;
    await db.query("insert into draft.player_pool_entries values($1,$2,$3,'NFL',$4,null,null,'free_agent')",[imp,p,s,'Live test fixture '+i]);
    await db.query("insert into draft.draft_pool_players values($1,$2,$3,'NFL',$4,null,null,'free_agent',true)",[d,imp,p,'Live test fixture '+i]);players.push(p);
  }
  await db.query("update draft.player_pool_imports set status='ready',completed_at=now() where id=$1",[imp]);await db.query('commit');
  const seen=[-1,-1];
  async function subscribe(i){
    const ch=clients[i].channel('live-test-'+d+'-'+randomUUID()).on('postgres_changes',{event:'UPDATE',schema:'draft',table:'live_updates',filter:`draft_id=eq.${d}`},msg=>{seen[i]=Number(msg.new.revision);});
    channels.push([clients[i],ch]);await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Subscription timeout')),15000);ch.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(t);resolve();}else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(t);reject(new Error('Subscription denied'));}});});return ch;
  }
  const state=()=>rpc(clients[0],'draft_state',{target:d});
  async function command(action,args={},client=clients[0]){const s=await state();return rpc(client,'draft_command',{target:d,request_id:randomUUID(),expected_revision:s.revision,action,args});}
  await command('set_order',{owners:owners.map(o=>o.id)});await command('set_timer',{seconds:30});
  stage='two authenticated subscriptions';await subscribe(0);await subscribe(1);
  const started=await command('start');await until(()=>seen.every(r=>r>=started.revision));
  stage='pick visible to both owners';let s=await state();const pick=s.picks[0].pick_id;
  const picked=await command('pick',{pick_id:pick,player_id:players[0]});await until(()=>seen.every(r=>r>=picked.revision));
  for(const client of clients){const pool=await rpc(client,'draft_available_players',{target:d});assert.ok(!pool.players.some(p=>p.player_id===players[0]));}
  console.log('PASS both authenticated subscribers receive revisions; selected player excluded for both');
  stage='pause survives scheduler ticks';await command('pause');s=await state();await wait(6500);assert.equal((await state()).revision,s.revision);
  // Shorten the paused remainder on this disposable fixture only, to avoid a
  // long hosted test. Resume itself still uses the real authorized command.
  await db.query('update draft.drafts set paused_remaining_seconds=2 where id=$1',[d]);
  stage='expiration with all subscribers disconnected';
  for(const [client,ch] of channels)await client.removeChannel(ch);channels=[];
  await command('resume');
  await until(async()=>Number((await db.query("select count(*) n from draft.draft_events where draft_id=$1 and event_type='timer_expire'",[d])).rows[0].n)===1);
  s=await state();assert.equal(s.current_pick_number,3);assert.ok(s.picks[1].skipped_at);assert.equal(s.picks[1].player_id,null);
  console.log('PASS paused draft preserved; database cron expires turn with no subscribers');
  stage='reconnect and makeup assignment';await subscribe(0);s=await state();const current=s.current_pick_number;
  const makeup=await command('assign',{pick_id:s.picks[1].pick_id,player_id:players[1]});await until(()=>seen[0]>=makeup.revision);assert.equal((await state()).current_pick_number,current);
  console.log('PASS reconnect state recovery and skipped-pick assignment preserves current turn');
}catch(e){const code=String(e.code??e.name);console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). Fixture is retained for inspection.`);process.exitCode=1;}
finally{
  for(const [client,ch] of channels)await client.removeChannel(ch);
  for(const client of clients)await client.removeAllChannels();
  if(db){try{await db.query('rollback');if(d){await db.query("update draft.drafts set status='cancelled',deadline_at=null,current_pick_number=null,paused_remaining_seconds=null,revision=revision+1 where id=$1",[d]);console.log('Disposable fixture cancelled: '+d);}}catch{console.error('Could not cancel fixture; check test database timers.');process.exitCode=1;}await db.end();}
}
