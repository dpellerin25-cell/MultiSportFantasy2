import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
export const calendar=JSON.parse(readFileSync(new URL('../../web/data/championship-calendar.json',import.meta.url),'utf8'));
export function championshipYear(sport,year){
 const offset=calendar.sports[sport]?.fantrax_to_championship_offset;
 assert.ok(Number.isInteger(offset),`${sport}: Fantrax seasonYear convention requires captured date evidence`);
 assert.ok(Number.isInteger(year));
 const result=year+offset;
 assert.ok(result>=calendar.first_championship_year,'Pre-launch season is not a championship');
 return result;
}
