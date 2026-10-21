import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {belongsToLiveChampionship, emptySeasonSnapshot} from '../src/lib/seasonSnapshot.ts';
import {scoreLeague} from '../src/lib/scoring.ts';
const calendar=JSON.parse(readFileSync(new URL('../data/championship-calendar.json',import.meta.url),'utf8'));
test('upcoming and mismatched-season snapshots can be scored without inventing results',()=>{
 for(const sport of Object.keys(calendar.sports)){
  const empty=emptySeasonSnapshot(sport);
  assert.deepEqual(scoreLeague(empty),[]);
  assert.deepEqual(empty.standings,[]);
 }
 // Actual populated results still require an approved points table.
 assert.throws(()=>scoreLeague({sport:'NFL',standings:[{team:'Owner',team_id:'1',rank:'1',fantasyPoints:'10'}]}),/approved placement/);
});
test('all five sports use the Cup start year and overlapping sports finish next year',()=>{
 assert.equal(calendar.first_championship_year,2027);
 for(const [sport,rule] of Object.entries(calendar.sports)){
  assert.equal(rule.spans_calendar_years,['NFL','NBA','EPL'].includes(sport));
  for(const year of [2027,2028]){
   assert.equal(belongsToLiveChampionship('live',year,year),true);
   assert.equal(belongsToLiveChampionship('live',year,year+1),false);
   assert.equal(belongsToLiveChampionship('upcoming',year,year),false);
   assert.equal(belongsToLiveChampionship('final',year,year+1),false);
  }
 }
 assert.equal(belongsToLiveChampionship('live',2027),false);
});
