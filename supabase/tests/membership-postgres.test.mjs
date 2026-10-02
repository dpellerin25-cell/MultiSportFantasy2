// Disposable PostgreSQL only. Never reads Supabase credentials or clears existing data.
import pg from 'pg';
import {readFile,readdir} from 'node:fs/promises';
import {membershipScenarios} from './membership-scenarios.mjs';
import {membershipTestConfig} from './membership-test-config.mjs';
let db;
try {
 const config=membershipTestConfig(process.env.LOCAL_MEMBERSHIP_TEST_DB_URL);
 db=new pg.Client(config);await db.connect();
 await db.query("set statement_timeout='20s';set lock_timeout='5s'");
 const namespaces=(await db.query("select 1 from pg_namespace where nspname in ('draft','auth','trading')")).rows;
 const tables=(await db.query("select 1 from pg_tables where schemaname not in ('pg_catalog','information_schema')")).rows;
 if(namespaces.length||tables.length)throw Error('Database is not empty; refusing to change it');
 await db.query(`do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 end $$;
 create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.query(await readFile(new URL(f,dir),'utf8'));
 await membershipScenarios({query:(...args)=>db.query(...args),exec:sql=>db.query(sql)});
 console.log('PASS isolated PostgreSQL membership validation. No Supabase project contacted. This checks database behavior, not hosted Auth or concurrent sessions.');
} catch(e){console.error(`FAIL isolated membership validation: ${e.message}`);process.exitCode=1;}
finally {if(db)await db.end();}
