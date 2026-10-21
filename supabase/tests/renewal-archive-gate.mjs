import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {championshipYear} from './championship-calendar.mjs';
export const initial=JSON.parse(await readFile(new URL('../../scripts/initial-season-exceptions.json',import.meta.url),'utf8'));
export function initialTransition(c){
 return initial.leagues[c.sport]===c.old_league_id && c.old_season_year===initial.old_season_year && c.season_year===initial.new_season_year && c.standings_league_id===c.old_league_id;
}
export async function requireRenewalArchive(c, root=new URL('../../web/data/history/',import.meta.url)){
 if(initialTransition(c))return;
 const year=championshipYear(c.sport,c.old_season_year);
 const file=c.sport==='EPL'?'premier-league':c.sport.toLowerCase();
 const archive=JSON.parse(await readFile(new URL(`${year}/${file}.json`,root),'utf8'));
 const meta=JSON.parse(await readFile(new URL(`${year}/archive-metadata.json`,root),'utf8'));
 const label=c.sport==='EPL'?'Premier League':c.sport;
 assert.equal(archive.sport,label);assert.equal(archive.league_id,c.old_league_id);
 assert.equal(archive.championship_year,year);assert.equal(meta.year,year);
 assert.equal(meta.sports[label].filename,`${file}.json`);
 assert.ok(Array.isArray(archive.standings)&&archive.standings.length>0);
}
