import assert from 'node:assert/strict';
import {loadPublicPicks} from '../src/lib/public-picks.ts';
const url='https://tgvuntuhdqucazpoxrrg.supabase.co',key='sb_publishable_fixture';
const payload={years:[2027,2028],ledger_ready:true,owners:[],picks:[]};
let calls=0;
assert.deepEqual(await loadPublicPicks(url,key,async(target,options)=>{
  calls++;assert.equal(target,url+'/rest/v1/rpc/rookie_pick_ownership');assert.equal(options.cache,'no-store');assert.equal(options.headers.apikey,key);assert.equal(options.headers.Authorization,undefined);
  return Response.json(payload);
}),payload);
assert.equal(calls,1);
await assert.rejects(()=>loadPublicPicks(undefined,key));
await assert.rejects(()=>loadPublicPicks(url,key,async()=>new Response('',{status:503})));
await assert.rejects(()=>loadPublicPicks(url,key,async()=>Response.json({})));
console.log('PASS public catalogue uses publishable key, no caching or owner credentials, failures never fall back to files');
