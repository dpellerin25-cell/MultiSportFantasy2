import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {rehearseMLB,RehearsalSetupError} from './mlb-rehearsal.mjs';
const db=await PGlite.create();
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`);
 const dir=new URL('../migrations/',import.meta.url);
 for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 await db.exec(`insert into draft.players(sport,name) values('MLB','Existing player'); insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fantrax','60ri2nbhmtj4b0km','001' from draft.players;`);
 await db.exec('begin');
 await rehearseMLB(db);
 await db.exec('rollback');
 for(const table of ['trading.league_renewals','trading.players','trading.trades','trading.roster_snapshots'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from draft.player_source_ids')).rows[0].n,1);
 await db.exec('begin');
 await db.exec(`insert into trading.trades(proposer_id,recipient_id) values((select id from draft.owners where slug='doug'),(select id from draft.owners where slug='chris'));`);
 await assert.rejects(()=>rehearseMLB(db,()=>{}),e=>e instanceof RehearsalSetupError&&e.message.includes('Active proposals'));
 assert.equal((await db.query('select count(*)::int n from trading.players')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from trading.league_renewals')).rows[0].n,0);
 await db.exec('rollback');
 console.log('PASS active-trade blocker explains prerequisite without changing trades or activating renewal');
 console.log('PASS shared rehearsal offline and full rollback; no hosted service contacted');
}finally{await db.close();}
