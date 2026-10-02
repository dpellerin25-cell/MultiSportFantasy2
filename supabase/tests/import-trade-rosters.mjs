// Explicit test-project import from already downloaded roster files. No Fantrax calls.
import pg from 'pg';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PROJECT,connectionConfig} from './hosted-validation.mjs';
const files=[['NFL','nfl','yg0olhfrmtj45dd6'],['MLB','mlb','60ri2nbhmtj4b0km'],['NBA','nba','u1byx3qkmtj47ogg'],['EPL','premier-league','j08ymyupmtj415q3'],['PGA','pga','xa7tza2hmthqz8bo']];
let db;
try{
  const mode=process.argv[2];assert.ok(['--preview','--import'].includes(mode),'Use --preview or --import');
  const settings=JSON.parse(await readFile(new URL('../../web/data/league-settings.json',import.meta.url),'utf8'));
  const expected=settings.owners.map(o=>o.slug).sort();
  const nameToSlug=new Map(settings.owners.map(o=>[o.name,o.slug]));
  const snapshots=[];
  for(const [sport,file,league] of files){
    const data=JSON.parse(await readFile(new URL(`../../web/data/rosters/${file}.json`,import.meta.url),'utf8'));
    assert.equal(data.league_id,league);assert.equal(data.team_count,expected.length);assert.equal(data.rosters.length,expected.length);
    const rosters=data.rosters.map(r=>{assert.equal(r.player_count,r.players.length);return {owner:nameToSlug.get(r.owner),players:r.players.map(p=>{assert.ok(typeof p.player_id==='string'&&p.player_id&&p.name);return {player_id:p.player_id,name:p.name};})};});
    assert.equal(new Set(rosters.map(r=>r.owner)).size,expected.length);
    assert.deepEqual(rosters.map(r=>r.owner).sort(),expected);
    const count=rosters.reduce((n,r)=>n+r.players.length,0);assert.equal(count,data.total_players);
    assert.equal(new Set(rosters.flatMap(r=>r.players.map(p=>p.player_id))).size,count);
    assert.ok(Number.isFinite(Date.parse(data.updated_at))&&Date.parse(data.updated_at)<=Date.now());
    snapshots.push({sport,league,observed:data.updated_at,rosters});
    console.log(`${sport}: ${count} players; snapshot ${data.updated_at}`);
  }
  if(mode==='--import'){
    assert.equal(process.env.DRAFT_TEST_CONFIRM,PROJECT);
    db=new pg.Client(connectionConfig(process.env.DRAFT_TEST_DATABASE_URL));await db.connect();await db.query('begin');
    for(const s of snapshots)await db.query('select trading.ingest_rosters($1,$2,$3,$4)',[s.sport,s.league,s.observed,JSON.stringify(s.rosters)]);
    await db.query('commit');console.log('Imported all five saved snapshots into the TEST trade database. Existing timestamps preserved.');
  }else console.log('Preview only. Inspect snapshot dates and counts before importing. These are saved rosters, not a fresh Fantrax fetch.');
}catch(e){console.error(`Trade roster import failed (${e.code??e.name}). No partial import committed.`);process.exitCode=1;}
finally{if(db){try{await db.query('rollback');}catch{}await db.end();}}
