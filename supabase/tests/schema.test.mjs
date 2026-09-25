import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

// In-memory PostgreSQL only. No URL, secrets, .env, or network connection.
const db = await PGlite.create();
let count = 0;
const sql = async text => (await db.query(text)).rows;
async function test(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
async function rejects(query, pattern) {
  await assert.rejects(() => db.exec(query), pattern);
}
try {
  // Minimal Supabase infrastructure, test-only. Production migrations never
  // create auth users or replace auth.uid(). Auth/RLS policies come later.
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as 'select null::uuid';`);
  const dir = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name,dir),'utf8'));
  }
  await test('exact nine owners, Doug exists, no automatic account/role grants', async()=>{
    const rows=await sql('select slug from draft.owners order by slug');
    assert.deepEqual(rows.map(r=>r.slug),['brendan','chris','doug','hatch','jack','jacob','nik','ryan','tucker']);
    assert.equal((await sql('select count(*)::int n from draft.league_roles'))[0].n,0);
    assert.equal((await sql('select count(*)::int n from draft.owner_accounts'))[0].n,0);
  });
  const d=(await sql(`insert into draft.drafts(name,kind,championship_year,rounds)
    values('Test startup','startup',2027,65) returning id`))[0].id;
  await test('startup minimums total 48, no sport maximums',async()=>{
    assert.deepEqual((await sql(`select sum(minimum)::int n,count(maximum)::int m from draft.draft_sport_rules where draft_id='${d}'`))[0],{n:48,m:0});
  });
  await test('requires complete order',()=>rejects(`select draft.generate_snake_picks('${d}')`,/complete contiguous/));
  await db.exec(`insert into draft.draft_participants select '${d}',id,row_number() over(order by slug) from draft.owners;`);
  await test('generates 585 snake slots',async()=>{
    assert.equal((await sql(`select draft.generate_snake_picks('${d}') n`))[0].n,585);
    const rows=await sql(`select p.overall_pick_number n,o.slug from draft.draft_picks p join draft.owners o on o.id=p.original_owner_id
      where draft_id='${d}' and overall_pick_number in(1,9,10,18,19,585) order by n`);
    assert.deepEqual(rows.map(r=>r.slug),['brendan','tucker','tucker','brendan','brendan','tucker']);
  });
  await test('cannot regenerate or reorder existing slots',async()=>{
    await rejects(`select draft.generate_snake_picks('${d}')`,/already generated/);
    await rejects(`update draft.draft_participants set order_position=20 where draft_id='${d}'`,/frozen/);
    await rejects(`update draft.draft_picks set round=2 where draft_id='${d}' and overall_pick_number=1`,/immutable/);
  });
  const imp=(await sql(`insert into draft.player_pool_imports(checksum,schema_version) values(repeat('a',64),1) returning id`))[0].id;
  const player=(await sql(`insert into draft.players(sport,name) values('NFL','Test Player') returning id`))[0].id;
  const source=(await sql(`insert into draft.player_source_ids(player_id,provider,league_id,external_player_id)
    values('${player}','fantrax','test-league','00001') returning id`))[0].id;
  await test('source identity unique and keeps leading zeroes',async()=>{
    await rejects(`insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values('${player}','fantrax','test-league','00001')`,/unique/);
    assert.equal((await sql(`select external_player_id from draft.player_source_ids where id='${source}'`))[0].external_player_id,'00001');
  });
  await db.exec(`insert into draft.player_pool_entries(import_id,player_id,source_id,sport,name,availability)
    values('${imp}','${player}','${source}','NFL','Test Player','waivers');
    update draft.drafts set import_id='${imp}' where id='${d}';
    insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,availability,eligible)
    values('${d}','${imp}','${player}','NFL','Test Player','waivers',true);
    update draft.drafts set status='running' where id='${d}';`);
  await test('pool frozen while draft running',()=>rejects(`update draft.draft_pool_players set name='Changed' where draft_id='${d}'`,/frozen/));
  const picks=await sql(`select id,current_owner_id owner from draft.draft_picks where draft_id='${d}' order by overall_pick_number limit 2`);
  const selectPlayer=(pick,sport='NFL')=>`insert into draft.draft_selections(draft_id,pick_id,owner_id,player_id,sport,method)
    values('${d}','${pick.id}','${pick.owner}','${player}','${sport}','commissioner')`;
  await test('selection sport and receiving owner must match',async()=>{
    await rejects(selectPlayer(picks[0],'MLB'),/foreign key/);
    await rejects(selectPlayer({...picks[0],owner:picks[1].owner}),/foreign key/);
  });
  await db.exec(selectPlayer(picks[0]));
  await test('player and pick cannot be selected twice',async()=>{
    await rejects(selectPlayer(picks[1]),/unique/);
    await rejects(selectPlayer(picks[0]),/unique/);
  });
  await test('selection history immutable, audit records round and pick',async()=>{
    await rejects(`delete from draft.draft_selections`,/cannot be deleted/);
    await rejects(`update draft.draft_selections set selected_at=now()`,/immutable/);
    assert.equal((await sql(`select (payload->>'round')::int r from draft.draft_events where draft_id='${d}'`))[0].r,1);
    await rejects('delete from draft.draft_events',/cannot be deleted/);
  });
  await test('void preserves history and releases player for reassignment',async()=>{
    await db.exec(`update draft.draft_selections set voided_at=clock_timestamp(),void_reason='Test undo';`);
    await db.exec(selectPlayer(picks[1]));
    assert.equal((await sql(`select count(*)::int n from draft.draft_selections`))[0].n,2);
    assert.equal((await sql(`select count(*)::int n from draft.draft_selections where voided_at is null`))[0].n,1);
  });
  await test('skipped slot remains available for later assignment',async()=>{
    await db.exec(`update draft.draft_picks set skipped_at=now() where id='${picks[0].id}';`);
    assert.equal((await sql(`select count(*)::int n from draft.draft_picks where draft_id='${d}'`))[0].n,585);
    await db.exec(`update draft.draft_selections set voided_at=clock_timestamp(),void_reason='Reassign to skipped slot' where voided_at is null;`);
    await db.exec(selectPlayer(picks[0]));
    assert.equal((await sql(`select count(*)::int n from draft.draft_selections where pick_id='${picks[0].id}' and voided_at is null`))[0].n,1);
  });
  await test('undo requires a reason and voided history cannot be revived',async()=>{
    await rejects(`update draft.draft_selections set voided_at=clock_timestamp() where voided_at is null`,/check constraint/);
    await rejects(`update draft.draft_selections set voided_at=null,void_reason=null where voided_at is not null`,/immutable/);
  });
  await test('role assignment requires a real auth user',()=>rejects(`insert into draft.league_roles values(gen_random_uuid(),'commissioner')`,/foreign key/));
  await test('anon and authenticated cannot read or mutate draft state',async()=>{
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        assert.equal((await sql('select * from draft.owners')).length,0);
        await rejects(`insert into draft.owners(slug,display_name) values('evil','Evil')`,/permission denied/);
        await rejects(`select draft.generate_snake_picks('${d}')`,/permission denied/);
        await rejects(`insert into draft.league_roles values(gen_random_uuid(),'commissioner')`,/permission denied/);
      } finally {await db.exec('reset role');}
    }
  });
  await test('every table has RLS and only the authorized command and membership helper are SECURITY DEFINER',async()=>{
    assert.equal((await sql(`select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='draft' and c.relkind='r' and not c.relrowsecurity`))[0].n,0);
    assert.equal((await sql(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='draft' and p.prosecdef and p.proname not in ('command','can_read_live')`))[0].n,0);
  });
  console.log(`${count} database tests passed. In-memory only; no Supabase connection.`);
} finally { await db.close(); }
