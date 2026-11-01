import test from 'node:test';
import assert from 'node:assert/strict';
import {checkpointLabel,canReviewPga,scoringRequest} from '../src/lib/scoring-controls-model.ts';
test('missing, incomplete and complete evidence labels distinguish 80 from 81',()=>{
 assert.equal(checkpointLabel({check_id:null}),'Missing');
 assert.equal(checkpointLabel({check_id:'a',complete:false}),'Pending — incomplete');
 assert.equal(checkpointLabel({check_id:'a',complete:true,total_players:80,cap:80}),'Complete — compliant');
 assert.equal(checkpointLabel({check_id:'a',complete:true,total_players:81,cap:80}),'Complete — over cap');
});
test('pause requires reason/confirmation and preserves expected event plus request identity',()=>{
 const r={kind:'pause',paused:true,expected:'12',reason:'Draft grace period'};
 assert.throws(()=>scoringRequest(r,false,'retry'));
 assert.throws(()=>scoringRequest({...r,reason:' '},true,'retry'));
 const request=scoringRequest(r,true,'retry');assert.equal(request.args.expected_event,'12');assert.equal(request.args.req,'retry');assert.deepEqual(scoringRequest(r,true,'retry'),request);
});
test('PGA decisions bind exact reviewed evidence; ordinary missing checks cannot be waived',()=>{
 assert.equal(canReviewPga({reason:'Missing or incomplete roster checks'}),false);
 const review={kind:'pga',choice:'waive',reason:'Approved grace period',result:{result_id:'r'},evidence:{result_id:'r',last_resolution_id:null,reason:'PGA pause boundary requires policy decision',checks:[{check_id:'a'}]}};
 const request=scoringRequest(review,true,'retry');assert.deepEqual(request.args.expected_checks,[{check_id:'a'}]);assert.equal(request.args.expected_resolution,null);
 assert.throws(()=>scoringRequest({...review,result:{result_id:'other'}},true,'retry'));
});
