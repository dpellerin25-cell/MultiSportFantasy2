import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {randomUUID as uuid} from 'node:crypto';
import {attachProspects} from './startup-prospect-attachment.mjs';
const db=await PGlite.create(),q=async(s,p=[])=>(await db.query(s,p)).rows;
try{
 await db.exec("create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;");
 const dir=new URL('../migrations/',import.meta.url);for(const f of (await readdir(dir)).filter(f=>f.endsWith('.sql')).sort())await db.exec(await readFile(new URL(f,dir),'utf8'));
 const cat=JSON.parse(await readFile(new URL('../../data/startup-prospects-2027.json',import.meta.url),'utf8'));
 assert.equal(cat.players.length,89);assert.deepEqual(cat.players.reduce((a,p)=>(a[p.sport]=(a[p.sport]??0)+1,a),{}),{NFL:34,NBA:29,EPL:26});
 assert.equal((await q('select count(*)::int n from draft.prospect_catalog_removals'))[0].n,3);
 assert.deepEqual((await q('select id from draft.prospect_catalog order by id')).map(p=>p.id),cat.players.map(p=>p.catalog_id));
 const removedNames=cat.excluded_players.map(p=>p.name);
 for(const name of removedNames)await q("insert into draft.players(sport,name) values('NFL',$1)",[name]);
 const beforeRemovalRetry=await q('select * from draft.players order by id');
 await db.exec(await readFile(new URL('../migrations/202611060002_remove_three_startup_prospects.sql',import.meta.url),'utf8'));
 assert.deepEqual(await q('select * from draft.players order by id'),beforeRemovalRetry);
 assert.equal((await q('select count(*)::int n from draft.prospect_catalog_removals'))[0].n,3);
 const user=uuid(),other=uuid();const owners=await q("select id from draft.owners where slug in ('doug','chris') order by slug desc");
 await q('insert into auth.users values($1),($2)',[user,other]);await q('insert into draft.owner_accounts values($1,$2),($3,$4)',[user,owners[0].id,other,owners[1].id]);await q("insert into draft.league_roles values($1,'commissioner')",[user]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 const imp=(await q("insert into draft.player_pool_imports(checksum,schema_version,completed_at) values(repeat('c',64),1,now()) returning id"))[0].id;
 const id=(await q("insert into draft.drafts(name,kind,championship_year,rounds,participant_count,import_id,pick_duration_seconds) values('Prospect test','startup',2027,80,2,$1,60) returning id",[imp]))[0].id;
 await q("insert into draft.players(sport,name) select 'NFL','Synthetic regular '||n from generate_series(1,170)n");
 await q("insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select id,'fixture','fixture',id::text from draft.players");
 await q("insert into draft.player_pool_entries select $1,p.id,s.id,p.sport,p.name,null,null,'free_agent' from draft.players p join draft.player_source_ids s on s.player_id=p.id",[imp]);
 await q("update draft.player_pool_imports set status='ready' where id=$1",[imp]);
 await q("insert into draft.draft_pool_players(draft_id,import_id,player_id,sport,name,availability,eligible) select $1,import_id,player_id,sport,name,availability,true from draft.player_pool_entries where import_id=$2",[id,imp]);
 const preview=await attachProspects(db,id);assert.equal(preview.prospects,89);assert.equal((await q('select count(*)::int n from draft.prospect_catalog where player_id is not null'))[0].n,0);
 await assert.rejects(()=>attachProspects(db,id,{approval:'bad'}),/Preview changed/);
 const result=await attachProspects(db,id,{approval:preview.approval_hash});assert.equal(result.added,89);
 const again=await attachProspects(db,id);assert.equal(again.added,0);
 const command=async(action,args={},who=user,request=uuid(),rev=null)=>{
  await q("select set_config('request.jwt.claim.sub',$1,false)",[who]);
  rev??=Number((await q('select revision from draft.drafts where id=$1',[id]))[0].revision);
  await db.exec('set role authenticated');try{return (await q('select draft.command($1,$2,$3,$4,$5) r',[id,request,rev,action,args]))[0].r;}finally{await db.exec('reset role');}
 };
 await command('set_order',{owners:owners.map(o=>o.id)});
 const available=async(sport,search='',cursor=null,size=100)=> (await q('select public.draft_available_players($1,$2,$3,$4,$5,null) r',[id,sport,search,cursor,size]))[0].r;
 const first=await available('Prospects','',null,40),second=await available('Prospects','',first.next_cursor,100);
 assert.equal(new Set([...first.players,...second.players].map(p=>p.player_id)).size,89);
 assert.equal((await available('EPL')).players.length,0);assert.equal((await available('NFL')).players.some(p=>p.is_prospect),false);
 assert.equal((await available(null)).players.some(p=>p.is_prospect),false);
 const soccer=(await available('Prospects','Mbapp')).players[0];assert.equal(soccer.availability_status,'prospect');assert.equal(soccer.sport,'EPL');
 await db.exec('set role authenticated');await assert.rejects(()=>q('select draft.attach_startup_prospects($1)',[id]),/permission denied/);await db.exec('reset role');
 await q("update draft.season_settings set owner_slugs=array['chris','doug'],placement_points=array[100,0] where championship_year=2027");
 await command('start');await assert.rejects(()=>attachProspects(db,id),/unstarted/);
 const slots=await q('select * from draft.draft_picks where draft_id=$1 order by overall_pick_number',[id]);
 const req=uuid(),rev=Number((await q('select revision from draft.drafts where id=$1',[id]))[0].revision);
 const args={pick_id:slots[0].id,player_id:soccer.player_id};
 await assert.rejects(()=>command('pick',args,other),/on the clock/);
 const picked=await command('pick',args,user,req,rev);assert.deepEqual(await command('pick',args,user,req,rev),picked);
 assert.equal((await q('select trading.prospect_count($1) n',[owners[0].id]))[0].n,1);
 assert.equal((await available('Prospects','Mbapp')).players.length,0);
 const p=(await q('select * from trading.prospects where draft_selection_id is not null'))[0];
 assert.equal(p.owner_id,owners[0].id);assert.equal(p.fantrax_id,null);
 const state=(await q('select public.draft_state($1) r',[id]))[0].r;assert.equal(state.picks[0].is_prospect,true);
 await assert.rejects(()=>command('pick',{pick_id:slots[1].id,player_id:soccer.player_id},other),/unique/);
 await command('pause');await command('undo',{selection_id:state.picks[0].selection_id,reason:'Synthetic undo test'});
 assert.equal((await q('select trading.prospect_count($1) n',[owners[0].id]))[0].n,0);assert.equal((await available('Prospects','Mbapp')).players.length,1);
 assert.equal((await q("select count(*)::int n from trading.prospect_events where action in ('draft_pick','draft_undo')"))[0].n,2);
 await command('assign',{pick_id:slots[0].id,player_id:soccer.player_id});
 const assigned=(await q("select * from trading.prospects where status='active' and draft_selection_id is not null"))[0];
 assert.equal(assigned.owner_id,owners[0].id);
 // A verified future ID preserves the canonical draft player, then same-owner
 // roster confirmation ends the manual slot (not a name-based match).
 const allOwners=await q('select slug from draft.owners where active');
 const rosters=allOwners.map(o=>({owner:o.slug,players:[]}));
 await q("select trading.ingest_rosters('EPL','future-epl',clock_timestamp(),$1,false)",[rosters]);
 await q("select set_config('request.jwt.claim.sub',$1,false)",[user]);
 await q("select public.prospect_command($1,'link',$2)",[uuid(),{id:assigned.id,revision:assigned.revision,fantrax_id:'future01',reason:'Verified synthetic future identity'}]);
 assert.equal((await q("select player_id from draft.player_source_ids where provider='fantrax' and external_player_id='future01'"))[0].player_id,soccer.player_id);
 await q("select trading.ingest_rosters('EPL','future-epl',clock_timestamp(),$1,false)",[rosters.map(r=>r.owner==='doug'?{...r,players:[{player_id:'future01',name:soccer.player_name}]}:r)]);
 assert.equal((await q('select status from trading.prospects where id=$1',[assigned.id]))[0].status,'confirmed');
 assert.equal((await q('select trading.prospect_count($1) n',[owners[0].id]))[0].n,0);
 console.log('PASS 89 supplied prospects, rollback preview/approval, attachment retry, private helpers, separate tabs, pagination, pick ownership/cap, duplicate denial, idempotent pick and audited undo.');
}finally{await db.close();}

