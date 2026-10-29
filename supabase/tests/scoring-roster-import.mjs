import {createHash} from 'node:crypto';
import {ScoringImportError} from './scoring-import.mjs';
const requireData=(ok,message)=>{if(!ok)throw new ScoringImportError(message);};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const uuid=h=>`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
export async function importHistoricalChecks(db,e,{apply=false,approval}={}){
 requireData(e?.version===1&&e.is_test===true,'Only explicit test roster-check imports are supported.');
 requireData(/^202[0-6]-\d\d-\d\d$/.test(e.check_date??''),'Historical checks must be pre-launch (2020–2026); current production checks are not enabled.');
 requireData(Number.isInteger(e.expected_revision)&&e.expected_revision>=0&&typeof e.reason==='string'&&e.reason.trim(),'Expected revision and reason are required.');
 requireData(e.snapshots&&Object.keys(e.snapshots).sort().join(',')==='EPL,MLB,NBA,NFL,PGA','All five original roster snapshot files are required.');
 const byOwner=new Map();let expectedOwners;
 for(const sport of ['NFL','MLB','NBA','EPL','PGA']){
   const s=e.snapshots[sport];
   requireData(s&&(s.sport===sport||(sport==='EPL'&&s.sport==='Premier League'))&&Array.isArray(s.rosters)&&s.rosters.length>0&&s.team_count===s.rosters.length&&typeof s.league_id==='string'&&s.league_id.length>0,'Invalid roster snapshot identity or team count.');
   const owners=new Set(),players=new Set();let total=0;
   for(const r of s.rosters){
     requireData(typeof r.owner==='string'&&!owners.has(r.owner)&&Array.isArray(r.players)&&r.player_count===r.players.length,'Invalid owner or player count.');owners.add(r.owner);
     for(const p of r.players){requireData(typeof p.player_id==='string'&&p.player_id.length>0&&!players.has(p.player_id),'Missing/duplicate roster player ID.');players.add(p.player_id);}
     total+=r.players.length;
     if(!byOwner.has(r.owner))byOwner.set(r.owner,[]);
     byOwner.get(r.owner).push({sport,count:r.players.length,source_ref:`sha256:${digest(s)}`,observed_at:s.updated_at});
   }
   requireData(total===s.total_players,'Snapshot total does not match its player records.');
   const membership=[...owners].sort().join('|');
   requireData(!expectedOwners||membership===expectedOwners,'Five snapshots do not cover the same owners.');expectedOwners=membership;
 }
 await db.query('begin');
 try{
   await db.query("set local statement_timeout='15s'");await db.query("set local lock_timeout='5s'");
   await db.query('select pg_advisory_xact_lock(731944,1)');
   const mapped=[];
   for(const [name,sports] of byOwner){
     const rows=(await db.query('select id from draft.owners where display_name=$1',[name])).rows;
     requireData(rows.length===1,'Snapshot owner must exactly match an existing website owner.');
     mapped.push({owner_id:rows[0].id,name,sports});
   }
   const plan_hash=digest({envelope:e,owners:mapped.map(o=>o.owner_id)});
   requireData(!apply||approval===plan_hash,'Approval differs from roster-check preview.');
   const owners=[];
   for(const o of mapped){
     const body={owner_id:o.owner_id,check_date:e.check_date,complete:true,reason:e.reason,sports:o.sports};
     const request=uuid(digest({type:'historical-roster-check-v1',body,revision:e.expected_revision}));
     const id=(await db.query('select scoring.record_roster_check($1,$2,$3) id',[request,JSON.stringify(body),e.expected_revision])).rows[0].id;
     owners.push({owner:o.name,total_players:o.sports.reduce((n,s)=>n+s.count,0),check_id:id});
   }
   await db.query(apply?'commit':'rollback');return {mode:apply?'import':'preview',is_test:true,check_date:e.check_date,plan_hash,owners};
 }catch(error){await db.query('rollback');throw error;}
}
