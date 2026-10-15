import assert from 'node:assert/strict';
export const OLD='60ri2nbhmtj4b0km',NEXT='rk8bvnk3mulovx9a';
export function validateManifest(data){
 assert.equal(data.schema_version,1);assert.equal(data.kind,'mlb-renewal-identities');assert.equal(data.capture_checks_passed,true);
 const start=Date.parse(data.started_at),end=Date.parse(data.completed_at);
 assert.ok(Number.isFinite(start)&&Number.isFinite(end)&&start<=end&&end<=Date.now()+60000,'Invalid capture dates');
 assert.deepEqual(Object.keys(data.leagues).sort(),[OLD,NEXT].sort());
 for(const [lid,year] of [[OLD,2026],[NEXT,2027]]){
   const league=data.leagues[lid];
   assert.equal(league.metadata.league_history_id,'ml3fdlq2mulovxoh');assert.equal(league.metadata.season_year,year);
   assert.ok(Array.isArray(league.players)&&league.players.length>0&&league.players.length<=100000);
   assert.equal(league.player_count,league.players.length);
   const seen=new Set();
   for(const p of league.players){assert.ok(typeof p.player_id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.player_id)&&typeof p.player_name==='string'&&p.player_name.trim()&&p.player_name.length<=300);assert.ok(!seen.has(p.player_id),'Duplicate ID');seen.add(p.player_id);}
 }
 return data;
}

export async function auditMLB(db,manifest){
 validateManifest(manifest);
 const q=async(s,p=[])=>(await db.query(s,p)).rows;
 const old=new Map(manifest.leagues[OLD].players.map(p=>[p.player_id,p.player_name]));
 const fresh=new Map(manifest.leagues[NEXT].players.map(p=>[p.player_id,p.player_name]));
 const rows=await q(`select s.external_player_id,s.player_id,p.name,p.sport,s.league_id,
   (select count(*)::int from draft.draft_selections d where d.player_id=p.id and d.voided_at is null) active_selections,
   (select count(*)::int from draft.draft_selections d where d.player_id=p.id and d.voided_at is not null) voided_selections,
   (select count(*)::int from draft.draft_pool_players d where d.player_id=p.id) frozen_pool_references
   from draft.player_source_ids s join draft.players p on p.id=s.player_id
   where s.provider='fantrax' and s.league_id in ($1,$2) order by s.external_player_id,s.league_id`,[OLD,NEXT]);
 const prior=rows.filter(r=>r.league_id===OLD), destination=rows.filter(r=>r.league_id===NEXT);
 const missing=prior.filter(r=>!fresh.has(r.external_player_id));
 const names=prior.filter(r=>fresh.has(r.external_player_id)&&fresh.get(r.external_player_id).trim().toLowerCase()!==r.name.trim().toLowerCase());
 const known=new Set(prior.map(r=>r.external_player_id));
 const trades=await q(`select p.fantrax_id,p.name,p.owner_id is not null rostered,
   (select count(*)::int from trading.assets a join trading.trades t on t.id=a.trade_id where a.player_id=p.id and t.status in ('proposed','accepted')) pending_trade_references
   from trading.players p where p.sport='MLB' and p.league_id in ($1,$2) order by p.fantrax_id`,[OLD,NEXT]);
 const missingTrades=trades.filter(p=>!fresh.has(p.fantrax_id));
 const blockers=[];
 if(!prior.length)blockers.push('No old-league database source identities found');
 if(rows.some(r=>r.sport!=='MLB'))blockers.push('Source identity sport mismatch');
 if(destination.length)blockers.push('Destination source mappings already exist; review activation state/conflicts');
 if(missing.length)blockers.push('Stored source IDs absent from new capture require review; retain historical identities');
 if(names.length)blockers.push('Stored player names differ from new capture; review identity before aliasing');
 if(missingTrades.some(r=>r.rostered||r.pending_trade_references))blockers.push('Rostered or pending-trade players absent from new capture');
 const details=r=>({player_id:r.external_player_id,player_name:r.name,present_in_old_capture:old.has(r.external_player_id),active_selections:r.active_selections,voided_selections:r.voided_selections,frozen_pool_references:r.frozen_pool_references});
 return {read_only:true,automatic_switch_performed:false,capture_completed_at:manifest.completed_at,
   scope:'Read-only database snapshot compared with earlier sequential Fantrax capture. Absence is not proof of deletion; this does not approve activation.',
   counts:{stored_old_sources:prior.length,destination_sources:destination.length,stored_ids_in_new_capture:prior.length-missing.length,
     stored_ids_absent_from_new:missing.length,absent_ids_with_active_selections:missing.filter(r=>r.active_selections>0).length,
     stored_name_differences:names.length,new_capture_ids_without_old_source:[...fresh.keys()].filter(id=>!known.has(id)).length,
     trade_players_absent_from_new:missingTrades.length},
   absent_stored_players:missing.slice(0,100).map(details),absent_list_truncated:missing.length>100,
   name_differences:names.slice(0,100).map(r=>({...details(r),captured_name:fresh.get(r.external_player_id)})),name_list_truncated:names.length>100,
   capture_old_only:[...old.keys()].filter(id=>!fresh.has(id)).slice(0,100).map(id=>({player_id:id,player_name:old.get(id)})),
   capture_new_only:[...fresh.keys()].filter(id=>!old.has(id)).slice(0,100).map(id=>({player_id:id,player_name:fresh.get(id)})),
   missing_trade_players:missingTrades.slice(0,100),blockers};
}
