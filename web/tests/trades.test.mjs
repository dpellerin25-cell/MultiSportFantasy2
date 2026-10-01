import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeAssets,proposal,tradeWarnings} from '../src/lib/trade-model.ts';
const data={viewer_owner_id:'doug',ledger_ready:true,owners:[{id:'doug',name:'Doug',can_receive:true},{id:'chris',name:'Chris',can_receive:true},{id:'jack',name:'Jack',can_receive:false}],
  players:[{id:'p',owner_id:'doug',name:'Player',sport:'NFL',reserved:false}],picks:[{id:'pick',owner_id:'chris',original_owner_id:'doug',year:2027,round:1}]};
test('mixed proposal uses stable database IDs, current owners, original pick label and exact request ID',()=>{
  const assets=tradeAssets(data);assert.match(assets[1].label,/Doug/);
  const command=proposal(data,'chris',assets,'retry-id');
  assert.deepEqual(command,{request_id:'retry-id',action:'propose',args:{recipient_id:'chris',assets:[{from_owner_id:'doug',player_id:'p'},{from_owner_id:'chris',pick_id:'pick'}]}});
  assert.deepEqual(proposal(data,'chris',assets,'retry-id'),command);
});
test('empty, self, unlinked, duplicate, unavailable and stale selections cannot be reviewed for sending',()=>{
  const assets=tradeAssets(data);
  assert.throws(()=>proposal(data,'doug',assets,'id'));
  assert.throws(()=>proposal(data,'jack',assets,'id'));
  assert.throws(()=>proposal(data,'chris',[],'id'));
  assert.throws(()=>proposal(data,'chris',[assets[0],assets[0]],'id'));
  assert.throws(()=>proposal({...data,ledger_ready:false},'chris',assets,'id'));
  assert.throws(()=>proposal({...data,players:[{...data.players[0],owner_id:'jack'}]},'chris',assets,'id'));
  assert.throws(()=>proposal({...data,players:[{...data.players[0],reserved:true}]},'chris',assets,'id'));
});
test('minimum warnings do not block a valid offer',()=>{
  const assets=tradeAssets(data);assert.ok(tradeWarnings(data,'chris',assets).some(w=>w.includes('Doug: NFL would have 0')));
  assert.equal(proposal(data,'chris',assets,'id').action,'propose');
});
