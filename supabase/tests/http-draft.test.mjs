// Opt-in hosted test. Never starts the rehearsal draft or selects a player.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PROJECT} from './hosted-validation.mjs';
const target='4f7c9484-bc03-46cf-ae5f-8a0781061844';
const base=`https://${PROJECT}.supabase.co`,key=process.env.DRAFT_TEST_PUBLISHABLE_KEY;
let stage='checking settings';
async function login(label){
  const email=process.env[`DRAFT_TEST_${label}_EMAIL`],password=process.env[`DRAFT_TEST_${label}_PASSWORD`];
  if(!email||!password)throw new Error('Missing test account settings');
  const r=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200);const session=await r.json();assert.ok(session.access_token);return session.access_token;
}
async function rpc(name,args,token){
  const r=await fetch(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
  return {status:r.status,ok:r.ok,body:await r.json()};
}
async function success(name,args,token){const r=await rpc(name,args,token);assert.equal(r.ok,true);return r.body;}
try{
  if(process.env.DRAFT_TEST_CONFIRM!==PROJECT||!key)throw new Error('Missing TEST settings');
  stage='signing in test accounts';const doug=await login('DOUG'),owner=await login('OWNER');
  stage='reading rehearsal through JWT-authenticated HTTP';
  const state=await success('draft_state',{target},doug);
  assert.equal(state.status,'setup');assert.equal(state.viewer_is_commissioner,true);
  assert.equal(state.participants.find(p=>p.owner_id===state.viewer_owner_id)?.slug,'doug');
  const other=await success('draft_state',{target},owner);assert.equal(other.viewer_is_commissioner,false);
  assert.equal(other.participants.find(p=>p.owner_id===other.viewer_owner_id)?.slug,'chris');
  assert.equal(other.participants.length,9);assert.equal(state.picks.length,0);
  console.log('PASS real JWT HTTP member reads and Doug/Chris identities');
  stage='checking anonymous and forged-token denial';
  for(const token of [null,'not-a-valid-jwt']){
    const r=await rpc('draft_state',{target},token);assert.ok([401,403].includes(r.status));
  }
  stage='checking other owner cannot change timer';
  const denied=await rpc('draft_command',{target,request_id:randomUUID(),expected_revision:state.revision,action:'set_timer',args:{seconds:state.timer_seconds}},owner);
  assert.equal(denied.ok,false);assert.match(denied.body.message??'',/Commissioner/);
  console.log('PASS anonymous/forged JWT denial and commissioner-only command');
  stage='reading bounded available-player pages';
  const first=await success('draft_available_players',{target,page_size:2},owner);
  assert.equal(first.players.length,2);assert.ok(first.next_cursor);
  const next=await success('draft_available_players',{target,page_size:2,after_player:first.next_cursor},owner);
  assert.equal(next.players.length,2);assert.equal(new Set([...first.players,...next.players].map(p=>p.player_id)).size,4);
  console.log('PASS HTTP player pool cursor pagination');
  stage='commissioner idempotent timer command (same duration)';
  const command={target,request_id:randomUUID(),expected_revision:state.revision,action:'set_timer',args:{seconds:state.timer_seconds}};
  const result=await success('draft_command',command,doug);
  assert.deepEqual(await success('draft_command',command,doug),result);
  const after=await success('draft_state',{target},doug);
  assert.equal(after.revision,state.revision+1);assert.equal(after.timer_seconds,state.timer_seconds);
  assert.equal(after.status,'setup');assert.equal(after.deadline_at,null);assert.equal(after.picks.length,0);
  console.log('PASS HTTP command and retry; draft remains unstarted. One timer command/audit record committed.');
}catch(e){const code=String(e.code??e.name);console.error(`FAIL ${stage} (${/^[A-Za-z0-9_]+$/.test(code)?code:'Error'}). No secrets printed; inspect the test stage before retrying.`);process.exitCode=1;}
