import assert from 'node:assert/strict';
import {initial,initialTransition,requireRenewalArchive} from './renewal-archive-gate.mjs';
import {mkdtemp, mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'cup-archive-'));
try{
 const root=pathToFileURL(dir+'/');
 for(const [sport,old] of Object.entries(initial.leagues)){
  const c={sport,old_league_id:old,standings_league_id:old,old_season_year:2026,season_year:2027};
  assert.ok(initialTransition(c));await requireRenewalArchive(c,root);
  assert.equal(initialTransition({...c,old_league_id:'different'}),false);
  assert.equal(initialTransition({...c,season_year:2028}),false);
  assert.equal(initialTransition({...c,standings_league_id:'retained'}),false);
 }
 await assert.rejects(()=>requireRenewalArchive({sport:'MLB',old_season_year:2026},root),/Pre-launch/);
 await mkdir(join(dir,'2027'));
 for(const sport of ['NFL','MLB','NBA','EPL','PGA']){
  const c={sport,old_league_id:'old',old_season_year:2027,season_year:2028};
  await assert.rejects(()=>requireRenewalArchive(c,root));
  const file=sport==='EPL'?'premier-league':sport.toLowerCase(),label=sport==='EPL'?'Premier League':sport;
  const archive={sport:label,league_id:'old',championship_year:2027,standings:[{team:'Fixture'}]};
  await writeFile(join(dir,`2027/${file}.json`),JSON.stringify(archive));
  await writeFile(join(dir,'2027/archive-metadata.json'),JSON.stringify({year:2027,sports:{[label]:{filename:`${file}.json`}}}));
  await requireRenewalArchive(c,root);
  await assert.rejects(()=>requireRenewalArchive({...c,old_league_id:'different'},root));
 }
 console.log('PASS pinned inaugural exceptions, MLB exclusion and all five later-season archive gates');
}finally{await rm(dir,{recursive:true,force:true});}
