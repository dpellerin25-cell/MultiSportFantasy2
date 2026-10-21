import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {belongsToLiveChampionship} from '../src/lib/seasonSnapshot.ts';
const calendar=JSON.parse(readFileSync(new URL('../data/championship-calendar.json',import.meta.url),'utf8'));
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
