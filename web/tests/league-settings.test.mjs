import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsInput,settingsRequest} from '../src/lib/league-settings-model.ts';
const members=[{slug:'doug',name:'Doug'},{slug:'alex',name:'Alex'}];
test('explicit per-place numbers required; no automatic expansion scoring',()=>{
 assert.throws(()=>settingsInput(2027,members,['100','']),/Enter one/);
 assert.throws(()=>settingsInput(2027,members,['100','100']),/decrease/);
 assert.throws(()=>settingsInput(2027,[members[0],members[0]],['100','0']),/unique/);
 assert.deepEqual(settingsInput(2027,members,['100','0']),{year_value:2027,members,points:[100,0]});
});
test('apply requires explicit confirmation and an unblocked preview; exact payload can be retried',()=>{
 const input=settingsInput(2027,members,['100','0']),preview={token:'token',can_apply:true};
 assert.throws(()=>settingsRequest(input,preview,false,'id'),/confirm/);
 assert.throws(()=>settingsRequest(input,{...preview,can_apply:false},true,'id'),/confirm/);
 assert.deepEqual(settingsRequest(input,preview,true,'id'),{...input,request_id:'id',preview_token:'token'});
});
