import {createHash} from 'node:crypto';

export const LEAGUES={NFL:'yg0olhfrmtj45dd6',MLB:'60ri2nbhmtj4b0km',NBA:'u1byx3qkmtj47ogg',EPL:'j08ymyupmtj415q3',PGA:'xa7tza2hmthqz8bo'};
const FILTERS={NFL:'FOOTBALL_OFFENSE',MLB:'ALL',NBA:'BASKETBALL_PLAYER',EPL:'ALL',PGA:'POS_500'};
export class PoolValidationError extends Error {}
const requireValid=(ok,message)=>{if(!ok)throw new PoolValidationError(message);};
const count=n=>Number.isSafeInteger(n)&&n>=0;
const nonempty=s=>typeof s==='string'&&s.trim().length>0;
const date=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));

export function validateExport(bytes){
  const data=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  requireValid(data.schema_version===1&&data.source==='Fantrax getPlayerStats'&&data.complete===true,'Unsupported or incomplete export');
  requireValid(date(data.started_at)&&date(data.completed_at)&&Date.parse(data.started_at)<=Date.parse(data.completed_at),'Invalid export timestamps');
  requireValid(data.sports&&Object.keys(data.sports).sort().join()===Object.keys(LEAGUES).sort().join(),'Exactly five sport summaries required');
  requireValid(Array.isArray(data.players)&&data.players.length>0&&data.total_players===data.players.length,'Player count mismatch or empty export');
  const seen=new Set(),stats=Object.fromEntries(Object.keys(LEAGUES).map(s=>[s,{total:0,free_agent:0,waivers:0}]));
  const players=data.players.map(p=>{
    requireValid(Object.hasOwn(LEAGUES,p.sport)&&p.league_id===LEAGUES[p.sport],'Unexpected sport/league');
    requireValid(nonempty(p.player_id)&&p.player_id===p.player_id.trim()&&nonempty(p.player_name),'Invalid player identity/name');
    requireValid(['position','professional_team'].every(k=>p[k]===null||nonempty(p[k])),'Invalid position/team');
    requireValid(['free_agent','waivers'].includes(p.availability_status),'Ineligible or unknown availability');
    const key=`${p.league_id}:${p.player_id}`;requireValid(!seen.has(key),'Duplicate player identity');seen.add(key);
    stats[p.sport].total++;stats[p.sport][p.availability_status]++;
    // Whitelist fields: never persist raw responses or arbitrary export extras.
    return Object.fromEntries(['player_id','player_name','sport','position','professional_team','availability_status','league_id'].map(k=>[k,p[k]]));
  });
  const summaries={};
  for(const [sport,league] of Object.entries(LEAGUES)){
    const s=data.sports[sport],n=stats[sport];
    requireValid(s?.complete===true&&s.league_id===league&&s.availability_filter==='ALL_AVAILABLE'&&s.effective_position_filter===FILTERS[sport],`${sport}: incomplete or unexpected filters`);
    requireValid(date(s.started_at)&&date(s.completed_at)&&Date.parse(s.started_at)>=Date.parse(data.started_at)&&Date.parse(s.completed_at)<=Date.parse(data.completed_at)&&Date.parse(s.started_at)<=Date.parse(s.completed_at),`${sport}: invalid timestamps`);
    requireValid(count(s.pages_retrieved)&&s.pages_retrieved>0&&count(s.raw_player_records)&&count(s.duplicate_records_removed)&&s.raw_player_records-s.duplicate_records_removed===n.total&&s.reported_total===n.total&&s.unique_available_players===n.total,`${sport}: inconsistent pagination/counts`);
    requireValid(s.unknown_status_count===0&&s.free_agent_count===n.free_agent&&s.waiver_count===n.waivers&&s.identified_free_agents===n.free_agent&&s.identified_waiver_players===n.waivers,`${sport}: availability counts mismatch`);
    requireValid(count(s.roster_snapshot_ids_checked),`${sport}: missing roster verification scope`);
    summaries[sport]={...n,league_id:league,pages_retrieved:s.pages_retrieved,raw_player_records:s.raw_player_records,duplicate_records_removed:s.duplicate_records_removed,started_at:s.started_at,completed_at:s.completed_at,roster_snapshot_ids_checked:s.roster_snapshot_ids_checked};
  }
  return {checksum:createHash('sha256').update(bytes).digest('hex'),players,metadata:{validator:'fantrax-export-v1',total_players:players.length,started_at:data.started_at,completed_at:data.completed_at,sports:summaries,roster_check_scope:'Saved snapshots only; not live roster verification',snapshot_scope:'Sequential league reads, not an atomic snapshot'}};
}

// Owns a single transaction. No draft or roster is created or modified.
export async function importPool(db,bytes){
  const pool=validateExport(bytes),q=async(s,p=[])=>(await db.query(s,p)).rows;
  await q('begin');
  try{
    await q("set local statement_timeout='120s'");await q("set local lock_timeout='15s'");
    // Serialize this trusted importer across files, preserving stable source mappings.
    await q('select pg_advisory_xact_lock(20260925,1)');
    const guard=await q("select 1 from pg_trigger where tgrelid='draft.player_pool_entries'::regclass and tgname='immutable_ready_entries' and tgenabled='O'");
    requireValid(guard.length===1,'Apply import snapshot migration first');
    const existing=(await q('select id,status from draft.player_pool_imports where checksum=$1',[pool.checksum]))[0];
    if(existing){requireValid(existing.status==='ready','Existing checksum is not finalized');
      const n=Number((await q('select count(*) n from draft.player_pool_entries where import_id=$1',[existing.id]))[0].n);
      requireValid(n===pool.players.length,'Existing snapshot count mismatch');
      await q('commit');return {import_id:existing.id,already_imported:true,total_players:n};}
    const id=(await q("insert into draft.player_pool_imports(checksum,schema_version,metadata) values($1,1,$2) returning id",[pool.checksum,JSON.stringify(pool.metadata)]))[0].id;
    await q(`create temporary table incoming_pool (player_id text,player_name text,sport text,position text,professional_team text,availability_status text,league_id text) on commit drop`);
    // Batches avoid one network round trip per player.
    for(let i=0;i<pool.players.length;i+=1000)await q(`insert into incoming_pool select * from jsonb_to_recordset($1::jsonb) as p(player_id text,player_name text,sport text,position text,professional_team text,availability_status text,league_id text)`,[JSON.stringify(pool.players.slice(i,i+1000))]);
    await q(`create temporary table resolved_pool on commit drop as select i.*,s.id source_id,coalesce(s.player_id,gen_random_uuid()) internal_id from incoming_pool i left join draft.player_source_ids s on s.provider='fantrax' and s.league_id=i.league_id and s.external_player_id=i.player_id`);
    requireValid((await q('select 1 from resolved_pool r join draft.players p on p.id=r.internal_id where p.sport::text<>r.sport limit 1')).length===0,'Existing player sport mismatch');
    await q(`insert into draft.players(id,sport,name,position,professional_team) select internal_id,sport::draft.sport,player_name,position,professional_team from resolved_pool where source_id is null`);
    await q(`insert into draft.player_source_ids(player_id,provider,league_id,external_player_id) select internal_id,'fantrax',league_id,player_id from resolved_pool where source_id is null`);
    await q(`insert into draft.player_pool_entries(import_id,player_id,source_id,sport,name,position,professional_team,availability) select $1,r.internal_id,s.id,r.sport::draft.sport,r.player_name,r.position,r.professional_team,r.availability_status::draft.availability from resolved_pool r join draft.player_source_ids s on s.provider='fantrax' and s.league_id=r.league_id and s.external_player_id=r.player_id`,[id]);
    const counts=await q('select sport,count(*)::int total from draft.player_pool_entries where import_id=$1 group by sport',[id]);
    for(const [sport,s] of Object.entries(pool.metadata.sports))requireValid((counts.find(c=>c.sport===sport)?.total??0)===s.total,'Database sport count mismatch');
    await q("update draft.player_pool_imports set status='ready',completed_at=clock_timestamp() where id=$1",[id]);
    const sample=await q('select distinct on (e.sport) s.external_player_id player_id,e.name player_name,e.sport,e.position,e.professional_team,e.availability availability_status,s.league_id from draft.player_pool_entries e join draft.player_source_ids s on s.id=e.source_id where e.import_id=$1 order by e.sport,e.player_id',[id]);
    await q('commit');return {import_id:id,already_imported:false,total_players:pool.players.length,sports:counts,sample};
  }catch(error){await q('rollback');throw error;}
}
