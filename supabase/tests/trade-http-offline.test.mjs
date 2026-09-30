import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {prepare,scenario,cleanup,httpApi,settings} from './trade-http-support.mjs';
const db=await PGlite.create();
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const users=[];
  for(const slug of ['doug','chris','jack']){
    const id=randomUUID();users.push({id,token:'fixture-'+slug});await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into draft.owner_accounts select $1,id from draft.owners where slug=$2',[id,slug]);
  }
  await db.query("insert into draft.league_roles values($1,'commissioner')",[users[0].id]);
  // Mock HTTP transport delegates RPC bodies to the actual migrated functions.
  // This checks scenario and permission behavior, not PostgREST routing.
  const api={raw:async()=>({ok:false,status:406}),rpc:async(name,args,token)=>{
    const u=users.find(u=>u.token===token);if(!u)return {ok:false,status:401};
    await db.exec('begin');
    try{
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[u.id]);await db.exec('set local role authenticated');
      const r=name==='trade_list'?await db.query('select public.trade_list() body'):await db.query('select public.trade_command($1,$2,$3) body',[args.request_id,args.action,JSON.stringify(args.args)]);
      await db.exec('commit');return {ok:true,status:200,body:r.rows[0].body};
    }catch(e){await db.exec('rollback');return {ok:false,status:e.code==='42501'?403:400};}
  }};
  const run=randomUUID(),f=await prepare(db,users,run);
  const id=await scenario(api,users,f,()=>{});
  assert.equal((await db.query("select count(*)::int n from trading.notifications n join trading.events e on e.id=n.event_id where e.trade_id=$1 and n.kind='acceptance'",[id])).rows[0].n,2);
  await cleanup(db,users[0].id,run);await cleanup(db,users[0].id,run);
  assert.equal((await db.query('select count(*)::int n from trading.picks where owner_id<>original_owner_id')).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from trading.notifications where status<>'failed' or next_attempt_at<>'infinity'")).rows[0].n,0);
  // Simulate interrupted run after acceptance: cleanup must reverse the pick.
  const interrupted=randomUUID(),f2=await prepare(db,users,interrupted);
  const proposed=await api.rpc('trade_command',{request_id:randomUUID(),action:'propose',args:{recipient_id:f2.owners[1],message:f2.message,assets:[{from_owner_id:f2.owners[0],pick_id:f2.picks[0]}]}},users[0].token);
  const accepted=await api.rpc('trade_command',{request_id:randomUUID(),action:'accept',args:{trade_id:proposed.body.trade_id,revision:0}},users[1].token);assert.ok(accepted.ok);
  await assert.rejects(()=>prepare(db,users,randomUUID()),/requires attention/);
  await cleanup(db,users[0].id,interrupted);
  assert.equal((await db.query('select count(*)::int n from trading.picks where owner_id<>original_owner_id')).rows[0].n,0);
  await assert.rejects(()=>cleanup(db,users[0].id,'bad-id'));
  assert.throws(()=>settings({}),/Missing settings/);
  // Verify real transport paths, JWT header and request serialization offline.
  const requests=[];
  const http=httpApi('test-key',async(url,options)=>{
    requests.push({url,options});return {ok:true,status:200,json:async()=>[]};
  });
  await http.rpc('trade_list',{},'test-token');await http.raw('test-token');
  assert.equal(requests[0].url,'https://tgvuntuhdqucazpoxrrg.supabase.co/rest/v1/rpc/trade_list');
  assert.equal(requests[0].options.headers.Authorization,'Bearer test-token');
  assert.equal(requests[0].options.body,'{}');assert.equal(requests[1].options.headers['Accept-Profile'],'trading');
  console.log('PASS HTTP trade scenario offline: privacy, lifecycle, retries, cleanup/recovery, test-ledger guards and transport shape. No hosted requests made.');
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await db.close();}
