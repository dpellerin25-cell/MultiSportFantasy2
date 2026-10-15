// Archive-gated, separately approved standings switch. Does not create/finalize archives.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import {syncConnection} from './trade-roster-sync.mjs';
import {checksum,SPORTS} from './yearly-renewal.mjs';
let db,stage='validating archive and explicit project';
try{
 const [mode,sport,year,...extra]=process.argv.slice(2);
 const initial=mode==='preview-initial'||mode==='apply-initial';
 const apply=mode==='apply'||mode==='apply-initial';
 assert.ok(['preview','apply','preview-initial','apply-initial'].includes(mode)&&SPORTS.includes(sport)&&(initial?!year:/^20\d\d$/.test(year))&&!extra.length);
 assert.ok(process.env.FANTRAX_RENEWAL_CONFIRM&&process.env.FANTRAX_RENEWAL_CONFIRM===process.env.TRADE_ROSTER_PROJECT_REF);
 const file=sport==='EPL'?'premier-league':sport.toLowerCase();
 const bytes=await readFile(new URL(initial?`../../web/data/${file}.json`:`../../web/data/history/${year}/${file}.json`,import.meta.url));
 const archive=JSON.parse(bytes.toString('utf8'));
 if(!initial){
 const meta=JSON.parse(await readFile(new URL(`../../web/data/history/${year}/archive-metadata.json`,import.meta.url),'utf8'));
 assert.equal(archive.championship_year,Number(year));
 assert.equal(meta.year,Number(year));assert.equal(meta.sports[archive.sport].filename,`${file}.json`);
 }
 assert.equal(archive.sport,sport==='EPL'?'Premier League':sport);
 assert.ok(Array.isArray(archive.standings)&&archive.standings.length>0);
 const settings=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
 db=new pg.Client(syncConnection(process.env));stage='reading standings state';await db.connect();
 await db.query(apply?'begin':'begin read only');
 await db.query("set local lock_timeout='30s'");await db.query("set local statement_timeout='30s'");
 await db.query('select pg_advisory_xact_lock(731943,1)');
 const state=(await db.query('select * from trading.fantrax_state where sport=$1',[sport])).rows[0];
 assert.ok(state&&state.league_id!==state.standings_league_id);
 assert.equal(archive.league_id,state.standings_league_id,'Archive must belong to the retained standings league');
 assert.equal(settings.championship_year,state.season_year+(['NFL','NBA','EPL'].includes(sport)?1:0),'Configure website championship season before releasing standings');
 const reason=initial?process.env.FANTRAX_INITIAL_RELEASE_REASON:'';
 if(initial)assert.ok(typeof reason==='string'&&reason.trim().length>=20,'Explain why these are not championship results');
 const plan={sport,old_league_id:state.standings_league_id,new_league_id:state.league_id,archive_year:initial?0:Number(year),archive_checksum:createHash('sha256').update(bytes).digest('hex'),release_kind:initial?'initial_setup':'archived_season',reason};
 const hash=checksum(plan);
 if(apply){
   stage='applying approved archive-gated standings release';assert.equal(process.env.FANTRAX_RENEWAL_APPROVE,hash,'Exact preview hash required');
   if(initial)await db.query('select trading.release_initial_fantrax_standings($1,$2,$3,$4,$5)',[sport,plan.old_league_id,plan.new_league_id,plan.archive_checksum,reason]);
   else await db.query('select trading.release_fantrax_standings($1,$2,$3,$4,$5)',[sport,plan.old_league_id,plan.new_league_id,plan.archive_year,plan.archive_checksum]);
   await db.query('commit');
 }else await db.query('rollback');
 console.log(JSON.stringify({preview_only:!apply,...plan,approval_hash:hash},null,2));
}catch(e){console.error(`Standings release failed while ${stage}. Check archive, season configuration, current state and exact approval hash. No fallback switch.`);process.exitCode=1;}
finally{if(db){await db.query('rollback').catch(()=>{});await db.end();}}
