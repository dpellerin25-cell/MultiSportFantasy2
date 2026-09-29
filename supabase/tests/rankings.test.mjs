import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const db=await PGlite.create(), q=async(sql,args=[])=>(await db.query(sql,args)).rows;
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;`);
  const dir=new URL('../migrations/',import.meta.url);
  for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
  assert.deepEqual((await q('select sport,count(*)::int n from draft.player_ranking_snapshot group by sport order by sport')).map(r=>[r.sport,r.n]),[['EPL',430],['MLB',591],['NBA',446],['NFL',369],['PGA',222]]);
  for(const [a,b] of [['Patrick Mahomes II','Patrick Mahomes'],['Ludvig Åberg','Ludvig Aberg'],['J.T. Poston','JT Poston'],['Nicolai Højgaard','Nicolai Hojgaard']]) {
    assert.equal((await q('select draft.ranking_name_key($1)=draft.ranking_name_key($2) ok',[a,b]))[0].ok,true);
  }
  const user=randomUUID(), outsider=randomUUID();
  await q('insert into auth.users values($1),($2)',[user,outsider]);
  await q("insert into draft.owner_accounts(auth_user_id,owner_id) select $1,id from draft.owners where slug='doug'",[user]);
  const target=(await q("insert into draft.drafts(name,kind,championship_year,rounds) values('Ranking fixture','startup',2027,65) returning id"))[0].id;
  await q('insert into draft.draft_participants select $1,id,row_number() over(order by slug) from draft.owners',[target]);
  await q('select draft.generate_snake_picks($1)',[target]);
  const imp=(await q("insert into draft.player_pool_imports(checksum,schema_version) values(repeat('d',64),1) returning id"))[0].id;
  await q('update draft.drafts set import_id=$1 where id=$2',[imp,target]);
  const records=[['NFL','Josh Allen'],['NFL','Patrick Mahomes'],['NFL',"Ja’Marr Chase"],['NBA','Josh Allen'],['PGA','Ludvig Aberg'],['MLB','Luis Garcia'],['NFL','Sam Smith'],['NFL','Sam Smith'],['NFL','Aardvark Unranked']];
  // Seed a source rank with a deliberately ambiguous pool identity.
  await q("insert into draft.player_ranking_snapshot(sport,entry_number,player_name,rank,source_url,ranking_type,captured_on) values('NFL',9999,'Sam Smith',1,'fixture','fixture','2026-09-29')");
  for(let i=0;i<130;i++)records.push(['NFL',`Fixture Unranked ${String(i).padStart(3,'0')}`]);
  for(const [sport,name] of records){
    const id=(await q('insert into draft.players(sport,name) values($1,$2) returning id',[sport,name]))[0].id;
    const sid=(await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) values($1,'fixture',$2,$1::uuid::text) returning id",[id,sport]))[0].id;
    await q("insert into draft.player_pool_entries(import_id,player_id,source_id,sport,name,availability) values($1,$2,$3,$4,$5,'free_agent')",[imp,id,sid,sport,name]);
    await q("insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,availability,eligible) values($1,$2,$3,$4,$5,'free_agent',true)",[target,imp,id,sport,name]);
  }
  await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  async function page(sport=null,cursor=null,size=30,search=''){
    return (await q('select public.draft_available_players($1,$2,$3,$4,$5) p',[target,sport,search,cursor,size]))[0].p;
  }
  const all=[];let cursor=null;
  do {const p=await page(null,cursor,7);all.push(...p.players);cursor=p.next_cursor;assert.ok(all.length<=records.length);}while(cursor);
  assert.equal(all.length,records.length);assert.equal(new Set(all.map(p=>p.player_id)).size,all.length);
  assert.deepEqual(all.slice(0,4).map(p=>[p.player_name,p.source_rank]),[['Josh Allen',1],["Ja’Marr Chase",2],['Ludvig Aberg',13],['Patrick Mahomes',18]]);
  assert.equal(all[4].player_name,'Aardvark Unranked');
  for(const p of all.slice(4))assert.equal(p.source_rank,null);
  assert.equal((await page('NBA')).players[0].source_rank,null);
  assert.equal((await page('NFL',null,30,'Mahomes')).players[0].source_rank,18);
  console.log('PASS complete snapshots, normalized identity, sport isolation, ambiguity rejection, global ranking and pagination');
  const first=await page('NFL',null,1);const selected=first.players[0];
  await q("update draft.drafts set status='running' where id=$1",[target]);
  const pick=(await q('select id,current_owner_id from draft.draft_picks where draft_id=$1 order by overall_pick_number limit 1',[target]))[0];
  await q("insert into draft.draft_selections(draft_id,pick_id,owner_id,player_id,sport,method) values($1,$2,$3,$4,'NFL','commissioner')",[target,pick.id,pick.current_owner_id,selected.player_id]);
  assert.equal((await page('NFL',first.next_cursor,1)).players[0].source_rank,2);
  assert.ok(!(await page('NFL')).players.some(p=>p.player_id===selected.player_id));
  await assert.rejects(()=>page(null,randomUUID()),/Invalid player cursor/);
  await assert.rejects(()=>page(null,null,101),/Invalid player search/);
  await q('set role authenticated');
  assert.equal((await page('NFL')).players[0].source_rank,2);
  await assert.rejects(()=>q('select * from draft.player_ranking_snapshot'),/permission denied/);
  await assert.rejects(()=>q("delete from draft.player_ranking_snapshot"),/permission denied/);
  await q('reset role');
  await q("select set_config('request.jwt.claim.sub',$1,false)",[outsider]);
  await assert.rejects(()=>page(),/access denied/);
  await q('set role anon');await assert.rejects(()=>page(),/permission denied/);
  console.log('PASS drafted cursor survives, selected players excluded, bounded input, members only and no direct ranking writes');
} finally {await db.close();}
