// Only an EMPTY, explicitly named, local disposable PostgreSQL database.
// Never reads Supabase settings. Leaves fixtures for inspection; no cleanup deletes.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {tradeRaceScenarios} from './trade-race-scenarios.mjs';
import {localTradeTestConfig} from './trade-test-config.mjs';

const config=localTradeTestConfig(process.env.LOCAL_TRADE_TEST_DB_URL);
const clients=Array.from({length:3},()=>new pg.Client(config));
const [admin,a,b]=clients;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let passed=0;
try{
  for(const c of clients){await c.connect();await c.query("set statement_timeout='15s';set idle_in_transaction_session_timeout='30s'");}
  const existing=(await admin.query("select count(*)::int n from pg_namespace where nspname in ('auth','draft','trading')")).rows[0].n;
  const tables=(await admin.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n;
  if(existing||tables)throw new Error('Database is not empty; refusing to modify it. Create a fresh disposable database.');
  await admin.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  end $$;
  create schema auth;create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await admin.query(await readFile(new URL(f,dir),'utf8'));
  const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
  async function race(firstOp,secondOp,beforeRelease=async()=>{}){
    let pending;
    await a.query('begin');await b.query('begin');
    try{
      const first=await firstOp(a);
      pending=secondOp(b).then(value=>({value}),error=>({error}));
      let blocked=false;
      for(let n=0;n<100;n++){
        const row=(await admin.query("select $1=any(pg_blocking_pids($2)) blocked",[pidA,pidB])).rows[0];
        if(row.blocked){blocked=true;break;}await wait(20);
      }
      assert.ok(blocked,'Second independent backend must wait for the first transaction; a sequential pass is not concurrency proof');
      await beforeRelease();await a.query('commit');
      const second=await pending;await b.query(second.error?'rollback':'commit');
      return {first,second};
    }finally{
      await a.query('rollback');
      if(pending)await pending;
      await b.query('rollback');
    }
  }
  await tradeRaceScenarios({admin,race,report:message=>{passed++;console.log('PASS independent PostgreSQL sessions: '+message);}});
  console.log(`${passed} trade concurrency scenarios passed. No hosted database contacted. Fixture data remains in the disposable database.`);
}catch(e){console.error(`FAIL trade concurrency: ${e.message}`);process.exitCode=1;}
finally{for(const c of clients){try{await c.query('rollback');}catch{}try{await c.end();}catch{}}}
