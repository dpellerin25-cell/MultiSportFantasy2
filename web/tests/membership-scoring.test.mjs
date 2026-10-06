import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreLeague} from '../src/lib/scoring.ts';
const rows=n=>Array.from({length:n},(_,i)=>({team:`Owner ${i}`,team_id:String(i),rank:String(i+1),fantasyPoints:'100'}));
test('8 and 10 owner scoring uses approved tables without changing dominance',()=>{
 for(const n of [8,10]){
  const points=Array.from({length:n},(_,i)=>(n-i-1)*10);
  const result=scoreLeague({sport:'NFL',standings:rows(n),placement_points:points});
  assert.deepEqual(result.map(r=>r.sportScore),points);
  assert.ok(result.every(r=>r.zScore===0));
 }
});
test('legacy nine-owner scoring retained; other sizes need explicit valid tables',()=>{
 assert.deepEqual(scoreLeague({sport:'NFL',standings:rows(9)}).map(r=>r.placementPoints),[100,80,65,52,40,30,20,10,0]);
 assert.throws(()=>scoreLeague({sport:'NFL',standings:rows(10)}),/approved placement/);
 assert.throws(()=>scoreLeague({sport:'NFL',standings:rows(8),placement_points:[100]}),/approved placement/);
 assert.throws(()=>scoreLeague({sport:'NFL',standings:rows(8),placement_points:Array(8).fill(0)}),/approved placement/);
});

test('approved John expansion uses exact ten-owner placement rules',async()=>{
 const {readFile}=await import('node:fs/promises');
 const settings=JSON.parse(await readFile(new URL('../data/league-settings.json',import.meta.url),'utf8'));
 assert.equal(settings.owners.length,10);assert.ok(settings.owners.some(o=>o.slug==='john'&&o.name==='John'));
 assert.deepEqual(scoreLeague({sport:'NFL',standings:rows(10),placement_points:settings.placement_points}).map(r=>r.placementPoints),[100,82,68,56,45,35,26,18,10,0]);
});
