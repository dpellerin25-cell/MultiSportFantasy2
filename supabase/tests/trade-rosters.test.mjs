import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const db=await PGlite.create();
try{
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to authenticated,anon;`);
  const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
  const user=randomUUID();await db.query('insert into auth.users values($1)',[user]);await db.query("insert into draft.owner_accounts select $1,id from draft.owners where slug='doug'",[user]);
  await db.query(`select trading.import_pick_ledger('{"version":1,"trades":[]}')`);
  const snapshot=(await db.query('select slug from draft.owners')).rows.map(o=>({owner:o.slug,players:o.slug==='doug'?[{player_id:'001',name:'Test NFL Player'}]:[]}));
  await db.query("select trading.ingest_rosters('NFL','test-nfl',clock_timestamp(),$1)",[JSON.stringify(snapshot)]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');
  const d=(await db.query('select public.trade_rosters() d')).rows[0].d;
  assert.equal(d.owners.length,9);assert.equal(d.picks.length,180);assert.equal(d.ledger_ready,true);assert.equal(d.owners.find(o=>o.id===d.viewer_owner_id).slug,'doug');assert.equal(d.owners.find(o=>o.slug==='chris').can_receive,false);
  assert.equal(d.players.length,1);assert.equal(d.players[0].fantrax_id,'001');assert.equal(d.players[0].league_id,'test-nfl');assert.equal(d.players[0].reserved,false);
  assert.equal(JSON.stringify(d).includes(user),false);await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);await db.exec('set role authenticated');await assert.rejects(()=>db.query('select public.trade_rosters()'),/Owner account/);await db.exec('reset role;set role anon');await assert.rejects(()=>db.query('select public.trade_rosters()'),/permission denied/);
  console.log('PASS trade roster catalogue: mapped owner only, next two pick years, receiving-account flags and no auth IDs');
}finally{await db.close();}
