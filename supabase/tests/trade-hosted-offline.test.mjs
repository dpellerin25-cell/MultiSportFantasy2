import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateHostedTrades} from './trade-hosted-validation.mjs';
const db=await PGlite.create();
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to anon,authenticated;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const users={doug:randomUUID(),chris:randomUUID(),jack:randomUUID()};
  for(const [slug,id] of Object.entries(users)){
    await db.query('insert into auth.users values($1)',[id]);
    await db.query('insert into draft.owner_accounts select $1,id from draft.owners where slug=$2',[id,slug]);
  }
  await db.query("insert into draft.league_roles values($1,'commissioner')",[users.doug]);
  await db.exec('begin');await validateHostedTrades(db,users.doug,users.chris,()=>{});await db.exec('rollback');
  for(const table of ['trades','picks','ledger_import','events','notifications','requests'])
    assert.equal((await db.query(`select count(*)::int n from trading.${table}`)).rows[0].n,0);
  await db.exec('begin');
  await db.query(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
  await assert.rejects(()=>validateHostedTrades(db,users.doug,users.chris,()=>{}),/unused/);await db.exec('rollback');
  await db.exec('begin');
  await db.query('delete from draft.owner_accounts where auth_user_id=$1',[users.jack]);
  await assert.rejects(()=>validateHostedTrades(db,users.doug,users.chris,()=>{}),/No third linked active owner/);await db.exec('rollback');
  await assert.rejects(()=>validateHostedTrades(db,users.doug,users.doug,()=>{}),/same account/);
  await assert.rejects(()=>validateHostedTrades(db,users.doug,randomUUID(),()=>{}),/not linked to the Chris owner/);
  console.log('PASS hosted trade scenario offline: permissions, lifecycle, privacy, unused-schema guard and full fixture rollback (not a hosted run)');
}catch(e){console.error(e.stack);process.exitCode=1;}finally{await db.close();}
