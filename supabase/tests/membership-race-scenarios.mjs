// Same assertions for offline sequential rehearsal and real independent PG sessions.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareDraft} from './draft-setup.mjs';
export async function membershipRaceScenarios({admin,race,report}) {
 const rows=async(c,s,p=[])=>(await c.query(s,p)).rows;
 const scalar=async(c,s,p=[])=>Object.values((await rows(c,s,p))[0])[0];
 const original=await rows(admin,'select id,slug,display_name name from draft.owners order by slug');
 const owners=Object.fromEntries(original.map(o=>[o.slug,o.id]));
 const users={doug:randomUUID(),chris:randomUUID()};
 for(const [slug,id] of Object.entries(users)){
  await admin.query('insert into auth.users values($1)',[id]);
  await admin.query('insert into draft.owner_accounts values($1,$2)',[id,owners[slug]]);
 }
 await admin.query("insert into draft.league_roles values($1,'commissioner')",[users.doug]);
 await admin.query(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
 const ten=[...original,{slug:'expansion',name:'Expansion'}];
 const eight=original.filter(o=>o.slug!=='tucker');
 const configure=members=>c=>c.query('select draft.configure_membership(2027,$1,$2,$3)',[
  JSON.stringify(members.map(({slug,name})=>({slug,name}))),members.map((_,i)=>(members.length-1-i)*10),users.doug]);
 const memberState=()=>rows(admin,'select owner_slugs,placement_points from draft.season_settings where championship_year=2027');
 const eventCount=()=>scalar(admin,'select count(*)::int from draft.membership_events');
 const activeCount=()=>scalar(admin,'select count(*)::int from draft.owners where active');
 const success=out=>{assert.ifError(out.error);return out.value;};
 const rejected=(out,pattern)=>assert.match(out.error?.message??'',pattern);
 const run=async op=>{await admin.query('begin');try{const value=await op(admin);await admin.query('commit');return value;}catch(e){await admin.query('rollback');throw e;}};
 const snapshot=(members,withPlayer=false)=>members.map(o=>({owner:o.slug,players:withPlayer&&o.slug==='tucker'?[{player_id:'race-player',name:'Synthetic test player'}]:[]}));
 const ingest=(members,withPlayer=false)=>c=>c.query("select trading.ingest_rosters('NFL','membership-fixture',clock_timestamp(),$1)",[JSON.stringify(snapshot(members,withPlayer))]);
 {
  const before=await scalar(admin,'select count(*)::int from trading.roster_snapshots');
  const {second}=await race(configure(eight),ingest(original));
  rejected(second,/active-owner/);assert.equal(await activeCount(),8);
  assert.equal(await scalar(admin,'select count(*)::int from trading.roster_snapshots'),before);
  report('membership first: stale nine-owner roster import rejected without snapshot writes');
 }
 await run(configure(original));
 {
  const before=await memberState(),audit=await eventCount();
  const {second}=await race(ingest(original,true),configure(eight));
  rejected(second,/Resolve roster/);assert.deepEqual(await memberState(),before);assert.equal(await eventCount(),audit);
  assert.equal(await scalar(admin,"select owner_id from trading.players where fantrax_id='race-player'"),owners.tucker);
  report('roster import first: newly rostered player prevents owner removal; settings and audit unchanged');
 }
 await run(ingest(original));
 const command=(slug,action,args)=>async c=>{
  await c.query("select set_config('request.jwt.claim.sub',$1,true)",[users[slug]]);
  await c.query('set local role authenticated');
  return scalar(c,'select public.trade_command($1,$2,$3)',[randomUUID(),action,JSON.stringify(args)]);
 };
 const propose=async round=>{
  const pick=await scalar(admin,'select id from trading.picks where original_owner_id=$1 and round=$2 order by year limit 1',[owners.doug,round]);
  const offer=await run(command('doug','propose',{recipient_id:owners.chris,assets:[{from_owner_id:owners.doug,pick_id:pick}]}));
  return {pick,accept:command('chris','accept',{trade_id:offer.trade_id,revision:offer.revision}),offer};
 };
 {
  const {pick,accept,offer}=await propose(1);
  const {second}=await race(configure(ten),accept);success(second);
  assert.equal(await activeCount(),10);assert.equal(await scalar(admin,'select owner_id from trading.picks where id=$1',[pick]),owners.chris);
  assert.equal(await scalar(admin,'select count(*)::int from trading.pick_history where pick_id=$1',[pick]),1);
  assert.equal(await scalar(admin,'select status from trading.trades where id=$1',[offer.trade_id]),'completed');
  report('membership first: expansion and queued acceptance serialize, transferring the pick exactly once');
 }
 await run(configure(original));
 {
  const {pick,accept}=await propose(2),before=await memberState(),audit=await eventCount();
  const {second}=await race(accept,configure(original.filter(o=>o.slug!=='chris')));
  rejected(second,/Resolve roster/);assert.deepEqual(await memberState(),before);assert.equal(await eventCount(),audit);
  assert.equal(await scalar(admin,'select owner_id from trading.picks where id=$1',[pick]),owners.chris);
  report('acceptance first: received/traded pick prevents contraction; acceptance remains committed');
 }
 // Real setup code with only its outer transaction boundaries delegated to the race harness.
 // Every validation, lock and write in prepareDraft still runs unchanged.
 const setup=c=>input=>prepareDraft({query:async(sql,p)=>{
  if(/^(begin(?: read only)?|commit|rollback)$/i.test(sql))return {rows:[]};
  return c.query(sql,p);
 }},input,{create:true});
 const sports=['NFL','MLB','NBA','EPL','PGA'];
 const metadata={validator:'fantrax-export-v1',total_players:750,sports:Object.fromEntries(sports.map(s=>[s,{total:150}]))};
 const imp=await scalar(admin,"insert into draft.player_pool_imports(checksum,schema_version,metadata) values(repeat('c',64),1,$1) returning id",[JSON.stringify(metadata)]);
 for(const sport of sports)await admin.query("insert into draft.players(sport,name) select $1,'Synthetic fixture '||n from generate_series(1,150) n",[sport]);
 await admin.query("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fixture',sport::text,id::text from draft.players");
 await admin.query("insert into draft.player_pool_entries select $1,p.id,s.id,p.sport,p.name,null,null,'free_agent' from draft.players p join draft.player_source_ids s on s.player_id=p.id",[imp]);
 await admin.query("update draft.player_pool_imports set status='ready',completed_at=clock_timestamp() where id=$1",[imp]);
 const config=()=>({draft_id:randomUUID(),import_id:imp,name:'Membership concurrency fixture',championship_year:2027,timer_seconds:90,owner_order:original.map(o=>o.slug)});
 {
  const c=config(),before=await memberState(),audit=await eventCount();
  const {second}=await race(db=>setup(db)(c),configure(ten));
  rejected(second,/Cancel unused/);assert.deepEqual(await memberState(),before);assert.equal(await eventCount(),audit);
  assert.equal(await scalar(admin,'select count(*)::int from draft.draft_participants where draft_id=$1',[c.draft_id]),9);
  await admin.query("update draft.drafts set status='cancelled' where id=$1",[c.draft_id]);
  report('setup first: queued membership change rejected; original nine-owner setup preserved');
 }
 {
  const c=config();const {second}=await race(configure(ten),db=>setup(db)(c));
  rejected(second,/Active owners/);assert.equal(await activeCount(),10);
  assert.equal(await scalar(admin,'select count(*)::int from draft.drafts where id=$1',[c.draft_id]),0);
  assert.equal(await scalar(admin,'select count(*)::int from draft.draft_participants where draft_id=$1',[c.draft_id]),0);
  report('membership first: stale draft setup rejected without partial draft or participant rows');
 }
 await run(configure(original));
 {
  const c=config();await prepareDraft(admin,c,{create:true});
  const before=await memberState(),audit=await eventCount();
  const start=async db=>{
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[users.doug]);await db.query('set local role authenticated');
   return scalar(db,"select draft.command($1,$2,0,'start','{}')",[c.draft_id,randomUUID()]);
  };
  const {second}=await race(start,configure(ten));
  rejected(second,/started or completed/);assert.deepEqual(await memberState(),before);assert.equal(await eventCount(),audit);
  const d=(await rows(admin,'select status,current_pick_number,deadline_at from draft.drafts where id=$1',[c.draft_id]))[0];
  assert.equal(d.status,'running');assert.equal(d.current_pick_number,1);assert.ok(d.deadline_at);
  assert.equal(await scalar(admin,'select count(*)::int from draft.draft_picks where draft_id=$1',[c.draft_id]),585);
  report('draft start first: queued membership change rejected; clock and all 585 snake slots preserved');
 }
}
