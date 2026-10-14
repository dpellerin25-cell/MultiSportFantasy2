// Dedicated local disposable database only. Never consumes Supabase credentials.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {mlbTestConfig} from './mlb-test-config.mjs';
import {mlbRaceScenario,scenarioNames} from './mlb-race-scenarios.mjs';
import {rehearseMLB} from './mlb-rehearsal.mjs';
const config=mlbTestConfig(process.env.LOCAL_MLB_TEST_DB_URL);
const base=new pg.Client(config);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function initialize(db){
 const existing=(await db.query("select count(*)::int n from pg_namespace where nspname in ('auth','draft','trading')")).rows[0].n;
 const tables=(await db.query("select count(*)::int n from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows[0].n;
 assert.equal(existing+tables,0,'Database must be empty; no existing data will be removed');
 await db.query(`do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 end $$;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.query(await readFile(new URL(f,dir),'utf8'));
}
try{
 await base.connect();await base.query("set statement_timeout='30s'");await initialize(base);
 await base.query(`insert into draft.players(sport,name) values('MLB','Fixture draft identity');insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fantrax','60ri2nbhmtj4b0km','001' from draft.players;`);
 await base.query('begin');
 try{await rehearseMLB(base);}finally{await base.query('rollback');}
 for(const table of ['trading.league_renewals','trading.trades','trading.players','trading.roster_snapshots'])assert.equal((await base.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 console.log('PASS PostgreSQL rehearsal rollback; no fixture trade or activation retained');
 for(const [index,name] of scenarioNames.entries()){
   // Fixed generated names; CREATE fails rather than reusing/deleting a database.
   const database=`multisport_mlb_race_${index+1}`;
   await base.query(`create database ${database} template template0`);
   const clients=Array.from({length:3},()=>new pg.Client({...config,database}));
   const [admin,a,b]=clients;
   try{
     for(const c of clients){await c.connect();await c.query("set statement_timeout='15s';set idle_in_transaction_session_timeout='30s'");}
     await initialize(admin);
     const pidA=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
     const pidB=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
     assert.notEqual(pidA,pidB);
     const race=async(firstOp,secondOp)=>{
       let pending;
       await a.query('begin');await b.query('begin');
       try{
         const first=await firstOp(a);
         pending=secondOp(b).then(value=>({value}),error=>({error}));
         let blocked=false;
         for(let i=0;i<150;i++){
           if((await admin.query('select $1=any(pg_blocking_pids($2)) blocked',[pidA,pidB])).rows[0].blocked){blocked=true;break;}
           await wait(20);
         }
         assert.ok(blocked,'Second backend must demonstrably wait on the first; sequential execution cannot pass');
         await a.query('commit');
         const second=await pending;await b.query(second.error?'rollback':'commit');
         return {first,second};
       }finally{
         await a.query('rollback');if(pending)await pending;await b.query('rollback');
       }
     };
     await mlbRaceScenario(name,{admin,race});
     console.log(`PASS independent sessions: ${name}; fixtures retained in ${database}`);
   }finally{for(const c of clients){try{await c.query('rollback');}catch{}try{await c.end();}catch{}}}
 }
 console.log('PASS isolated PostgreSQL rehearsal and four observed-lock races. No Supabase or Fantrax contacted.');
}catch(e){console.error(`FAIL isolated MLB test: ${e.message}`);process.exitCode=1;}
finally{try{await base.query('rollback');}catch{}await base.end();}
