import test from 'node:test';
import assert from 'node:assert/strict';
import {tradeAssets,proposal,tradeWarnings,activeOffers,archivedOffers,leagueCompletedTrades,recentlyCompleted,completedTradeHours,canRespond,offerResponse,counterSelection,counterProposal} from '../src/lib/trade-model.ts';
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
test('zero players in a sport does not warn or block a valid offer',()=>{
  const assets=tradeAssets(data);assert.deepEqual(tradeWarnings(data,'chris',assets),[]);
  assert.equal(proposal(data,'chris',assets,'id').action,'propose');
});
const now=Date.parse('2026-10-01T12:00:00Z');
const offer={id:'offer',proposer_id:'doug',recipient_id:'chris',status:'proposed',revision:4,expires_at:'2099-10-08T12:00:00Z',corrected_at:null,assets:[{from_owner_id:'doug',to_owner_id:'chris',player_id:'p',pick_id:null},{from_owner_id:'chris',to_owner_id:'doug',player_id:null,pick_id:'pick'}]};
test('active list hides every closed state and expired offer; accepted trades remain league-wide until completed',()=>{
  const rows=[offer,...['declined','completed','countered','expired','withdrawn','invalidated'].map(status=>({...offer,id:status,status})),{...offer,id:'deadline',expires_at:'2026-10-01T11:00:00Z'},{...offer,id:'pending',status:'accepted',expires_at:'2026-01-01T00:00:00Z'}];
  assert.deepEqual(activeOffers(rows,'doug',now).map(o=>o.id),['offer','pending']);
  assert.deepEqual(activeOffers(rows,'jack',now).map(o=>o.id),['pending']);
  assert.equal(activeOffers([{...offer,status:'completed'}],'chris',now).length,0);
});
test('only current recipient may act; command retains revision and retry ID',()=>{
  assert.equal(canRespond(offer,'doug',now),false);assert.equal(canRespond(offer,'jack',now),false);
  assert.equal(canRespond({...offer,status:'accepted'},'chris',now),false);
  assert.equal(canRespond({...offer,expires_at:new Date(now).toISOString()},'chris',now),false);
  for(const action of ['accept','decline']){
    assert.deepEqual(offerResponse(offer,'chris',action,'retry'),{request_id:'retry',action,args:{trade_id:'offer',revision:4}});
    assert.throws(()=>offerResponse(offer,'doug',action,'retry'));
  }
});
test('counter prefills both sides without reversing asset ownership; send targets the original proposer',()=>{
  const recipientData={...data,viewer_owner_id:'chris'};
  const selected=counterSelection(recipientData,offer);
  assert.deepEqual(selected.map(a=>a.owner_id),['doug','chris']);
  const cmd=counterProposal(recipientData,offer,selected,'counter-retry');
  assert.equal(cmd.action,'counter');assert.equal(cmd.args.recipient_id,'doug');assert.equal(cmd.args.trade_id,offer.id);assert.equal(cmd.args.revision,4);
  assert.deepEqual(counterProposal(recipientData,offer,selected,'counter-retry'),cmd);
  assert.throws(()=>counterSelection({...recipientData,players:[]},offer));
  assert.throws(()=>counterSelection({...recipientData,players:[{...data.players[0],reserved:true}]},offer));
  assert.throws(()=>counterSelection(data,offer));
});

test('private archive excludes league completions and other owner negotiations',()=>{
  const rows=[offer,...['declined','completed','countered','expired','withdrawn','invalidated','accepted'].map(status=>({...offer,id:status,status})),{...offer,id:'deadline',expires_at:new Date(now).toISOString()}];
  assert.deepEqual(archivedOffers(rows,'doug',now).map(o=>o.id),['declined','countered','expired','withdrawn','invalidated','deadline']);
  assert.deepEqual(archivedOffers(rows,'chris',now).map(o=>o.id),archivedOffers(rows,'doug',now).map(o=>o.id));
  assert.deepEqual(archivedOffers(rows,'jack',now).map(o=>o.id),[]);
  assert.deepEqual(leagueCompletedTrades(rows,now).map(o=>o.id),['completed']);
  assert.deepEqual(archivedOffers([],'doug',now),[]);
  const activeIds=new Set(activeOffers(rows,'doug',now).map(o=>o.id));
  assert.ok(archivedOffers(rows,'doug',now).every(o=>!activeIds.has(o.id)));
});

test('65-player limit warns without imposing a sport minimum',()=>{
  const full={...data,players:Array.from({length:65},(_,i)=>({id:'c'+i,owner_id:'chris',name:'Player',sport:'NFL',reserved:false})).concat(data.players)};
  assert.deepEqual(tradeWarnings(full,'chris',[tradeAssets(full).find(a=>a.id==='p')]),['Chris: roster would have 66 players (65-player limit).']);
});


test('completed pick trades remain league-visible for exactly 48 hours; player and mixed trades for 24',()=>{
  const completedAt=new Date(now).toISOString();
  const pickOnly={...offer,status:'completed',completed_at:completedAt,assets:[offer.assets[1]]};
  const playerOnly={...offer,status:'completed',completed_at:completedAt,assets:[offer.assets[0]]};
  const mixed={...offer,status:'completed',completed_at:completedAt};
  for(const [trade,hours] of [[pickOnly,48],[playerOnly,24],[mixed,24]]){
    assert.equal(completedTradeHours(trade),hours);
    const deadline=now+hours*3600000;
    assert.equal(recentlyCompleted(trade,deadline-1),true);
    assert.deepEqual(activeOffers([trade],'jack',deadline-1),[trade]);
    assert.deepEqual(leagueCompletedTrades([trade],deadline-1),[]);
    assert.deepEqual(archivedOffers([trade],'doug',deadline-1),[]);
    assert.equal(recentlyCompleted(trade,deadline),false);
    assert.deepEqual(activeOffers([trade],'jack',deadline),[]);
    assert.deepEqual(leagueCompletedTrades([trade],deadline),[trade]);
    assert.equal(canRespond(trade,'chris',now),false);
  }
});

test('completion window uses confirmation timestamp, handles reversals, and does not hide missing-date history',()=>{
  const pending={...offer,status:'accepted',completed_at:null};
  assert.deepEqual(activeOffers([pending],'jack',now+90*86400000),[pending]);
  const corrected={...offer,status:'completed',corrected_at:new Date(now-86400000).toISOString(),completed_at:new Date(now).toISOString()};
  assert.equal(recentlyCompleted(corrected,now+23*3600000),true);
  for(const completed_at of [undefined,null,'invalid']){
    const old={...offer,status:'completed',completed_at};
    assert.deepEqual(leagueCompletedTrades([old],now),[old]);
    assert.deepEqual(activeOffers([old],'jack',now),[]);
  }
});
