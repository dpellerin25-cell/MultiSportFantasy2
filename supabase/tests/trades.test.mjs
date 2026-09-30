import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';

const db=await PGlite.create();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const scalar=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
const json=JSON.stringify;
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const owners=Object.fromEntries((await q('select slug,id from draft.owners')).map(o=>[o.slug,o.id]));
  const users=Object.fromEntries(Object.keys(owners).map(o=>[o,randomUUID()]));
  for(const [slug,user] of Object.entries(users)){
    await q('insert into auth.users values($1)',[user]);
    await q('insert into draft.owner_accounts values($1,$2)',[user,owners[slug]]);
  }
  await q("insert into draft.league_roles(auth_user_id,role) values($1,'commissioner')",[users.doug]);
  const as=async(owner,fn)=>{
    await q("select set_config('request.jwt.claim.sub',$1,false)",[users[owner]??owner??'']);
    await db.exec('set role authenticated');
    try{return await fn();}finally{await db.exec('reset role');}
  };
  const command=(owner,action,args,id=randomUUID())=>as(owner,()=>scalar('select public.trade_command($1,$2,$3::jsonb)',[id,action,json(args)]));
  const list=owner=>as(owner,()=>scalar('select public.trade_list()'));
  const year=await scalar("select extract(year from clock_timestamp() at time zone 'UTC')::int+1");
  const pick=(owner,round=1,y=year)=>scalar('select id from trading.picks where original_owner_id=$1 and round=$2 and year=$3',[owners[owner],round,y]);
  const asset=(owner,id,kind='pick')=>({from_owner_id:owners[owner],[kind+'_id']:id});
  const propose=(owner,to,assets,extra={})=>command(owner,'propose',{recipient_id:owners[to],assets,...extra});
  const act=(owner,action,t,extra={})=>command(owner,action,{trade_id:t.trade_id,revision:t.revision,...extra});
  const state=id=>q('select * from trading.trades where id=$1',[id]).then(r=>r[0]);

  await test('ledger cutover required; contradictory history rolls back; legacy ownership and exact retry preserved',async()=>{
    await assert.rejects(()=>propose('doug','chris',[]),/Import legacy/);
    const transfer={id:'legacy-1',year,round:1,originalOwner:'Doug',from:'Doug',to:'Chris',tradedAt:'2026-09-01T00:00:00Z'};
    await assert.rejects(()=>q('select trading.import_pick_ledger($1)',[json({version:1,trades:[transfer,{...transfer,id:'legacy-2'}]})]),/Contradictory/);
    assert.equal(await scalar('select count(*)::int from trading.picks'),0);
    const ledger={version:1,trades:[transfer]};
    await q('select trading.import_pick_ledger($1)',[json(ledger)]);
    await q('select trading.import_pick_ledger($1)',[json(ledger)]);
    assert.equal(await scalar('select count(*)::int from trading.picks'),180);
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[await pick('doug')]),owners.chris);
    assert.equal(await scalar('select count(*)::int from trading.pick_history'),1);
    await assert.rejects(()=>q('select trading.import_pick_ledger($1)',[json({version:1,trades:[]})]),/different legacy/);
  });

  const roster=(placements={})=>Object.keys(owners).map(owner=>({owner,players:placements[owner]??[]}));
  const player=(id,name=id)=>({player_id:id,name});
  const ingest=(sport,placements,time)=>q('select trading.ingest_rosters($1,$2,$3,$4)',[sport,'league-'+sport,time,json(roster(placements))]);
  const initial=new Date(Date.now()-60000).toISOString();
  await test('complete roster snapshots, stable source IDs, invalid/stale imports roll back',async()=>{
    await ingest('NFL',{doug:[player('001','NFL One')],chris:[player('002')]},initial);
    await ingest('MLB',{chris:[player('001','MLB One')]},initial);
    await ingest('NFL',{doug:[player('001','NFL One')],chris:[player('002')]},initial);
    assert.equal(await scalar('select count(*)::int from trading.players'),3);
    await assert.rejects(()=>ingest('NFL',{},initial),/Stale/);
    await assert.rejects(()=>q('select trading.ingest_rosters($1,$2,clock_timestamp(),$3)',['NBA','league-NBA',json(roster().slice(1))]),/nine-owner/);
    const bad=roster({doug:[player('same')],chris:[player('same')]});
    await assert.rejects(()=>q('select trading.ingest_rosters($1,$2,clock_timestamp(),$3)',['NBA','league-NBA',json(bad)]),/duplicate player/);
    assert.equal(await scalar("select count(*)::int from trading.roster_snapshots where sport='NBA'"),0);
    assert.equal(await scalar("select count(*)::int from trading.players where fantrax_id='001'"),2);
  });
  const nfl=await scalar("select id from trading.players where sport='NFL' and fantrax_id='001'");
  const mlb=await scalar("select id from trading.players where sport='MLB'");

  await test('private proposals, including commissioner exclusion; ownership and duplicate assets enforced',async()=>{
    const id=await pick('chris',2);
    const t=await propose('chris','jack',[asset('chris',id)],{message:'Private negotiation'});
    assert.ok((await list('jack')).some(x=>x.id===t.trade_id));
    assert.ok(!(await list('doug')).some(x=>x.id===t.trade_id));
    await assert.rejects(()=>act('doug','accept',t),/not permitted/);
    await assert.rejects(()=>propose('doug','jack',[asset('doug',id)]),/ownership/);
    const count=await scalar('select count(*)::int from trading.trades');
    await assert.rejects(()=>propose('chris','jack',[asset('chris',id),asset('chris',id)]),/unique/);
    assert.equal(await scalar('select count(*)::int from trading.trades'),count);
    const accepted=await act('jack','accept',t);
    assert.equal(accepted.status,'completed');
    const visible=(await list('doug')).find(x=>x.id===t.trade_id);
    assert.equal(visible.message,null);
    assert.ok(accepted.warnings.length>0);
  });

  await test('acceptance transfers picks atomically, invalidates conflicts and retries exactly once',async()=>{
    const id=await pick('doug',2);
    const t=await propose('doug','chris',[asset('doug',id)]);
    const competing=await propose('doug','jack',[asset('doug',id)]);
    const request=randomUUID(),args={trade_id:t.trade_id,revision:t.revision};
    const result=await command('chris','accept',args,request);
    const events=await scalar('select count(*)::int from trading.events');
    assert.deepEqual(await command('chris','accept',args,request),result);
    assert.equal(await scalar('select count(*)::int from trading.events'),events);
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[id]),owners.chris);
    assert.equal((await state(competing.trade_id)).status,'invalidated');
    await assert.rejects(()=>act('jack','accept',competing),/changed/);
    await assert.rejects(()=>command('chris','decline',args,request),/reused/);
    assert.equal(await scalar("select count(*)::int from trading.notifications n join trading.events e on e.id=n.event_id where e.trade_id=$1 and n.kind='acceptance'",[t.trade_id]),2);
  });

  await test('counter is a new immutable offer; decline/withdraw permissions and notification kinds',async()=>{
    const a=asset('ryan',await pick('ryan'));
    const t=await propose('ryan','nik',[a]);
    await assert.rejects(()=>act('ryan','counter',t,{recipient_id:owners.nik,assets:[a]}),/receiving owner/);
    const c=await act('nik','counter',t,{recipient_id:owners.ryan,assets:[a,asset('nik',await pick('nik'))]});
    assert.equal((await state(t.trade_id)).status,'countered');
    await assert.rejects(()=>act('nik','accept',c),/not permitted/);
    await act('ryan','decline',c);
    const w=await propose('ryan','nik',[a]);
    await assert.rejects(()=>act('nik','withdraw',w),/not permitted/);
    await act('ryan','withdraw',w);
    const kinds=(await q('select distinct kind from trading.notifications')).map(x=>x.kind);
    for(const kind of ['proposal','counter','decline','acceptance'])assert.ok(kinds.includes(kind));
  });

  await test('seven-day expiry enforced without a scheduler; expiration is idempotent',async()=>{
    const t=await propose('hatch','tucker',[asset('hatch',await pick('hatch'))]);
    const diff=await scalar('select extract(epoch from expires_at-created_at) from trading.trades where id=$1',[t.trade_id]);
    assert.ok(Math.abs(Number(diff)-604800)<1);
    await q("update trading.trades set created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 day' where id=$1",[t.trade_id]);
    assert.equal((await list('tucker')).find(x=>x.id===t.trade_id).status,'expired');
    await assert.rejects(()=>act('tucker','accept',t),/expired/);
    assert.equal(await scalar('select trading.expire_offers()'),1);
    assert.equal(await scalar('select trading.expire_offers()'),0);
  });

  let mixed;
  await test('mixed cross-sport trade reserves players and transfers picks; partial Fantrax confirmation stays pending',async()=>{
    mixed=await propose('doug','chris',[asset('doug',nfl,'player'),asset('chris',mlb,'player'),asset('doug',await pick('doug',3))]);
    mixed=await act('chris','accept',mixed);
    assert.equal(mixed.status,'accepted');
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[await pick('doug',3)]),owners.chris);
    await assert.rejects(()=>propose('doug','jack',[asset('doug',nfl,'player')]),/awaiting Fantrax/);
    await ingest('NFL',{chris:[player('001'),player('002')]},new Date().toISOString());
    assert.equal((await state(mixed.trade_id)).status,'accepted');
    await ingest('MLB',{},new Date().toISOString());
    assert.equal((await state(mixed.trade_id)).status,'accepted');
    await ingest('MLB',{doug:[player('001')]},new Date().toISOString());
    assert.equal((await state(mixed.trade_id)).status,'completed');
    assert.equal(await scalar('select count(*)::int from trading.player_reservations'),0);
  });

  await test('commissioner reversal requires reason; restores picks and waits for fresh reverse player transfers',async()=>{
    const t=await state(mixed.trade_id),target={trade_id:t.id,revision:t.revision};
    await assert.rejects(()=>act('chris','correct',target,{reason:'Correction'}),/Commissioner/);
    await assert.rejects(()=>act('doug','correct',target),/reason/);
    const reversed=await act('doug','correct',target,{reason:'Owners agreed to reverse an erroneous trade'});
    assert.equal(reversed.status,'accepted');
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[await pick('doug',3)]),owners.doug);
    await ingest('NFL',{doug:[player('001')],chris:[player('002')]},new Date().toISOString());
    await ingest('MLB',{chris:[player('001')]},new Date().toISOString());
    const s=await state(t.id);assert.equal(s.status,'completed');
    await assert.rejects(()=>act('doug','correct',{trade_id:s.id,revision:s.revision},{reason:'Again'}),/One audited/);
    assert.equal(await scalar("select count(*)::int from trading.events where trade_id=$1 and action='correct'",[s.id]),1);
  });

  await test('failed acceptance and reversal roll back every asset and audit record',async()=>{
    const a=await pick('brendan',1),b=await pick('brendan',2);
    const t=await propose('brendan','jacob',[asset('brendan',a),asset('brendan',b)]);
    await q('update trading.picks set owner_id=$1 where id=$2',[owners.jack,b]);
    const count=await scalar('select count(*)::int from trading.pick_history');
    await assert.rejects(()=>act('jacob','accept',t),/ownership changed/);
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[a]),owners.brendan);
    assert.equal(await scalar('select count(*)::int from trading.pick_history'),count);
    await q('update trading.picks set owner_id=$1 where id=$2',[owners.brendan,b]);
    const accepted=await act('jacob','accept',t);
    const onward=await propose('jacob','jack',[asset('jacob',b)]);await act('jack','accept',onward);
    await assert.rejects(()=>act('doug','correct',accepted,{reason:'Cannot silently undo onward trade'}),/ownership changed/);
    assert.equal(await scalar('select owner_id from trading.picks where id=$1',[a]),owners.jacob);
  });

  await test('RLS, anonymous/outsider denial, helper isolation and immutable history',async()=>{
    assert.equal(await scalar("select count(*)::int from pg_tables t join pg_class c on c.relname=t.tablename join pg_namespace n on n.oid=c.relnamespace and n.nspname=t.schemaname where t.schemaname='trading' and not c.relrowsecurity"),0);
    await assert.rejects(()=>list(randomUUID()),/Owner account/);
    await q("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role anon');
    try{await assert.rejects(()=>q('select public.trade_list()'),/permission denied/);}finally{await db.exec('reset role');}
    for(const sql of ['select * from trading.trades',"select trading.seed_picks(2029)",'select trading.reconcile()',"insert into trading.picks(year,round,original_owner_id,owner_id) select 2029,1,id,id from draft.owners limit 1"])
      await assert.rejects(()=>as('doug',()=>q(sql)),/permission denied/);
    for(const table of ['assets','events','pick_history','roster_snapshots','ledger_import','requests'])
      await assert.rejects(()=>q(`delete from trading.${table}`),/immutable/);
  });
  await test('year bounds, inactive accounts, stale revisions and refreshed ownership prevent invalid acceptance',async()=>{
    await q('select trading.seed_picks($1)',[year+2]);
    const farPick=await pick('doug',1,year+2);
    await assert.rejects(()=>propose('doug','chris',[asset('doug',farPick)]),/next two/);
    const t=await propose('hatch','nik',[asset('hatch',await pick('hatch',2))]);
    await assert.rejects(()=>act('nik','accept',{...t,revision:99}),/changed/);
    await q('update draft.owners set active=false where id=$1',[owners.hatch]);
    await assert.rejects(()=>act('nik','accept',t),/inactive/);
    await assert.rejects(()=>list('hatch'),/Owner account/);
    await q('update draft.owners set active=true where id=$1',[owners.hatch]);
    const p=await propose('doug','jack',[asset('doug',nfl,'player')]);
    await ingest('NFL',{chris:[player('001'),player('002')]},new Date().toISOString());
    assert.equal((await state(p.trade_id)).status,'invalidated');
    await assert.rejects(()=>act('jack','accept',p),/changed/);
    const before=await scalar('select count(*)::int from trading.roster_snapshots');
    const malformed=roster();malformed[1]=malformed[0];
    await assert.rejects(()=>q("select trading.ingest_rosters('NBA','league-NBA',clock_timestamp(),$1)",[json(malformed)]),/snapshot owner/);
    assert.equal(await scalar('select count(*)::int from trading.roster_snapshots'),before);
  });
  console.log(`${passed} trade test groups passed. Offline only; no hosted database or email service contacted.`);
}catch(e){console.error(e.message);process.exitCode=1;}finally{await db.close();}
