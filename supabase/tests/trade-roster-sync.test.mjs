import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ROSTER_FILES,validateRosters,syncConnection,syncRosters,SyncSettingsError} from './trade-roster-sync.mjs';

const ref='tgvuntuhdqucazpoxrrg';
const env={TRADE_ROSTER_PROJECT_REF:ref,TRADE_ROSTER_DATABASE_URL:`postgresql://postgres:fake@db.${ref}.supabase.co:5432/postgres`};
assert.equal(syncConnection(env).ssl.rejectUnauthorized,true);
assert.equal(syncConnection({...env,TRADE_ROSTER_DATABASE_URL:`postgresql://postgres.${ref}:fake@aws-0-us-east-1.pooler.supabase.com:5432/postgres`}).ssl.rejectUnauthorized,true);
for(const value of [undefined,'postgresql://postgres:fake@localhost:5432/postgres',env.TRADE_ROSTER_DATABASE_URL+'?sslmode=disable',env.TRADE_ROSTER_DATABASE_URL.replace(':5432',':6543'),env.TRADE_ROSTER_DATABASE_URL.replace(ref,'abcdefghijklmnopqrst')])assert.throws(()=>syncConnection({...env,TRADE_ROSTER_DATABASE_URL:value}));
assert.throws(()=>syncConnection({...env,TRADE_ROSTER_CA_CERT:'not a certificate'}));
for(const [patch,message] of [
  [{TRADE_ROSTER_PROJECT_REF:undefined},'repository Variable'],
  [{TRADE_ROSTER_DATABASE_URL:undefined},'repository Secret'],
  [{TRADE_ROSTER_DATABASE_URL:' '+env.TRADE_ROSTER_DATABASE_URL},'whitespace'],
  [{TRADE_ROSTER_DATABASE_URL:'"'+env.TRADE_ROSTER_DATABASE_URL+'"'},'cannot be parsed'],
  [{TRADE_ROSTER_DATABASE_URL:env.TRADE_ROSTER_DATABASE_URL.replace(':5432',':6543')},'port must be 5432'],
  [{TRADE_ROSTER_DATABASE_URL:env.TRADE_ROSTER_DATABASE_URL+'?sslmode=require'},'query parameters'],
  [{TRADE_ROSTER_DATABASE_URL:env.TRADE_ROSTER_DATABASE_URL.replace('postgres:fake@','wrong:fake@')},'username'],
  [{TRADE_ROSTER_CA_CERT:'/tmp/supabase-ca.crt'},'complete PEM'],
])assert.throws(()=>syncConnection({...env,...patch}),error=>{
  assert.ok(error instanceof SyncSettingsError);
  assert.ok(error.message.includes(message));
  assert.ok(!error.message.includes('fake')&&!error.message.includes(env.TRADE_ROSTER_DATABASE_URL));
  return true;
});
console.log('PASS actionable setting-specific errors without passwords, URIs or certificate contents');
console.log('PASS explicit project guard, direct/session-pooler allowlist and mandatory TLS verification');

const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const owners=await q('select id,slug,display_name name from draft.owners order by slug');
  const settings={owners},bySlug=Object.fromEntries(owners.map(o=>[o.slug,o.id]));
  const base=Date.now(),iso=n=>new Date(base+n).toISOString();
  function files(start=-60000,moved=false){
    return ROSTER_FILES.map(([sport,,league])=>{
      const rosters=owners.map(o=>({owner:o.name,players:(sport==='NFL'&&o.slug===(moved?'chris':'doug'))||(sport==='MLB'&&o.slug===(moved?'doug':'chris'))?[{player_id:'001',name:sport+' Player'}]:[]}));
      for(const r of rosters)r.player_count=r.players.length;
      return {sport:sport==='EPL'?'Premier League':sport,league_id:league,fetch_started_at:iso(start),updated_at:iso(start+1000),team_count:owners.length,total_players:rosters.reduce((n,r)=>n+r.player_count,0),rosters};
    });
  }
  const valid=()=>files();
  for(const mutate of [
    f=>f.pop(),f=>{f[0].league_id='wrong';},f=>{f[0].fetch_started_at=undefined;},
    f=>{f[0].fetch_started_at=iso(-7*3600000);},f=>{f[0].updated_at=iso(10000);},
    f=>{f[0].rosters.pop();},f=>{f[0].rosters[0].owner='Unknown';},
    f=>{f[0].total_players=20;},f=>{f[0].rosters.find(r=>r.player_count).players[0].player_id=null;},
    f=>{const r=f[0].rosters.find(r=>r.player_count);r.players.push({...r.players[0]});r.player_count++;f[0].total_players++;},
  ]){const f=valid();mutate(f);assert.throws(()=>validateRosters(settings,f,base));}
  console.log('PASS missing sports, incorrect identity/membership/counts, duplicates and stale/future timestamps rejected');
  const initial=validateRosters(settings,files(),base);
  await syncRosters(db,initial);
  assert.equal((await q('select count(*)::int n from trading.roster_snapshots'))[0].n,5);
  await syncRosters(db,initial);
  assert.equal((await q('select count(*)::int n from trading.roster_snapshots'))[0].n,5);
  assert.equal((await q('select count(*)::int n from trading.players'))[0].n,2);
  console.log('PASS five-sport import, legitimate empty rosters, cross-sport IDs and idempotent retry');

  const trade=(await q("insert into trading.trades(proposer_id,recipient_id,status,accepted_at) values($1,$2,'accepted',$3) returning id",[bySlug.doug,bySlug.chris,iso(-5000)]))[0].id;
  const players=await q('select * from trading.players');
  for(const p of players){
    const to=p.sport==='NFL'?bySlug.chris:bySlug.doug;
    await q('insert into trading.assets(trade_id,from_owner_id,to_owner_id,player_id) values($1,$2,$3,$4)',[trade,p.owner_id,to,p.id]);
    await q('insert into trading.player_reservations values($1,$2)',[p.id,trade]);
  }
  // File writes are after acceptance, but reads began before it: must not confirm.
  const during=files(-10000,true);for(const f of during)f.updated_at=iso(-1000);
  await syncRosters(db,validateRosters(settings,during,base));
  assert.equal((await q('select status from trading.trades where id=$1',[trade]))[0].status,'accepted');
  const priorMLB=validateRosters(settings,files(-4000,true),base)[1];
  await q('select trading.ingest_rosters($1,$2,$3,$4)',[priorMLB.sport,priorMLB.league,priorMLB.observed,JSON.stringify(priorMLB.rosters)]);
  // Old MLB snapshot matches the trade. Fresh NFL matches too, but the new MLB
  // snapshot no longer matches. Never complete using a mixture of old/new data.
  const mixed=files(-2000,true);mixed[1]=files(-2000,false)[1];
  assert.equal((await syncRosters(db,validateRosters(settings,mixed,base))).completed_trades,0);
  assert.equal((await q('select status from trading.trades where id=$1',[trade]))[0].status,'accepted');
  console.log('PASS batch waits for all sports; a later mismatch cannot falsely complete a trade');
  const next=validateRosters(settings,files(-1000,true),base);
  const failing=structuredClone(next);failing[4].rosters[0].owner='unknown';
  await assert.rejects(()=>syncRosters(db,failing),/Invalid snapshot owner/);
  assert.equal((await q('select count(*)::int n from trading.roster_snapshots'))[0].n,16);
  assert.equal((await q('select status from trading.trades where id=$1',[trade]))[0].status,'accepted');
  assert.equal((await q('select count(*)::int n from trading.player_reservations'))[0].n,2);
  const result=await syncRosters(db,next);
  assert.equal(result.completed_trades,1);
  assert.equal((await q('select status from trading.trades where id=$1',[trade]))[0].status,'completed');
  assert.equal((await q('select count(*)::int n from trading.player_reservations'))[0].n,0);
  assert.equal((await syncRosters(db,next)).completed_trades,0);
  await assert.rejects(()=>syncRosters(db,initial),/Stale/);
  assert.equal((await q("select count(*)::int n from trading.events where action='completed'"))[0].n,1);
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    await assert.rejects(()=>q('select trading.ingest_roster_batch($1)',[JSON.stringify(next)]),/permission denied/);
    await assert.rejects(()=>q("select trading.ingest_rosters('NFL','x',now(),'[]',true)"),/permission denied/);
    await db.exec('reset role');
  }
  console.log('PASS conservative observation time, atomic rollback including completion/reservations, fresh completion, no duplicate audit and stale rejection');
}finally{await db.close();}
