export type TradeAsset = {key:string;id:string;kind:"player"|"pick";owner_id:string;label:string;sport?:string;unavailable?:string};
export type TradeRoster = {
  viewer_owner_id:string;ledger_ready:boolean;
  owners:{id:string;name:string;slug:string;can_receive:boolean}[];
  players:{id:string;owner_id:string;name:string;sport:string;fantrax_id:string;league_id:string;reserved:boolean}[];
  picks:{id:string;owner_id:string;original_owner_id:string;year:number;round:number}[];
};
export type Offer={id:string;proposer_id:string;recipient_id:string;status:string;revision:number;expires_at:string;corrected_at:string|null;completed_at?:string|null;assets:{from_owner_id:string;to_owner_id:string;player_id:string|null;pick_id:string|null}[]};
export type TradeCommand={request_id:string;action:string;args:Record<string,unknown>};
export function completedTradeHours(offer:Offer){
  return offer.assets.some(a=>a.player_id!==null)?24:48;
}
export function recentlyCompleted(offer:Offer,now=Date.now()){
  const completed=Date.parse(offer.completed_at??"");
  return offer.status==="completed"&&Number.isFinite(completed)&&now<completed+completedTradeHours(offer)*60*60*1000;
}
export function leagueCompletedTrades(offers:Offer[],now=Date.now()){
  return offers.filter(o=>o.status==="completed"&&!recentlyCompleted(o,now));
}
export function activeOffers(offers:Offer[],viewer:string,now=Date.now()){
  return offers.filter(o=>o.status==="accepted"||recentlyCompleted(o,now)||(o.status==="proposed"&&Date.parse(o.expires_at)>now&&[o.proposer_id,o.recipient_id].includes(viewer)));
}
export function canRespond(offer:Offer,viewer:string,now=Date.now()){
  return offer.status==="proposed"&&offer.recipient_id===viewer&&Date.parse(offer.expires_at)>now;
}
export function archivedOffers(offers:Offer[],viewer:string,now=Date.now()){
  return offers.filter(o=>[o.proposer_id,o.recipient_id].includes(viewer)&&(
    ["declined","countered","expired","withdrawn","invalidated"].includes(o.status)||
    (o.status==="proposed"&&Date.parse(o.expires_at)<=now)
  ));
}
export function offerResponse(offer:Offer,viewer:string,action:"accept"|"decline",requestId:string):TradeCommand{
  if(!canRespond(offer,viewer))throw new Error("This offer is no longer available to respond to.");
  return {request_id:requestId,action,args:{trade_id:offer.id,revision:offer.revision}};
}
export function counterSelection(data:TradeRoster,offer:Offer){
  if(!canRespond(offer,data.viewer_owner_id))throw new Error("This offer is no longer available to counter.");
  const assets=tradeAssets(data);
  return offer.assets.map(a=>{
    const found=assets.find(x=>x.kind===(a.player_id?"player":"pick")&&x.id===(a.player_id??a.pick_id));
    if(!found||found.owner_id!==a.from_owner_id||found.unavailable)throw new Error("An asset in this offer is no longer available. Refresh trades before countering.");
    return found;
  });
}
export function counterProposal(data:TradeRoster,offer:Offer,selected:TradeAsset[],requestId:string):TradeCommand{
  if(!canRespond(offer,data.viewer_owner_id))throw new Error("This offer is no longer available to counter.");
  const cmd=proposal(data,offer.proposer_id,selected,requestId);
  return {...cmd,action:"counter",args:{...cmd.args,trade_id:offer.id,revision:offer.revision}};
}
export function tradeAssets(data:TradeRoster):TradeAsset[]{
  return [...data.players.map(p=>({key:`player:${p.id}`,id:p.id,kind:"player" as const,owner_id:p.owner_id,label:p.name,sport:p.sport,unavailable:p.reserved?"Awaiting Fantrax transfer":undefined})),
    ...data.picks.map(p=>({key:`pick:${p.id}`,id:p.id,kind:"pick" as const,owner_id:p.owner_id,label:`${p.year} · Round ${p.round} · ${data.owners.find(o=>o.id===p.original_owner_id)?.name ?? "Original owner"}'s pick`}))];
}
export function proposal(data:TradeRoster,recipient:string,selected:TradeAsset[],requestId:string){
  if(!data.ledger_ready)throw new Error("Trade picks have not been set up yet.");
  if(recipient===data.viewer_owner_id||!data.owners.some(o=>o.id===recipient&&o.can_receive))throw new Error("Choose another linked owner.");
  if(!selected.length||selected.length>200)throw new Error("Choose at least one player or pick (up to 200).");
  const current=new Map(tradeAssets(data).map(a=>[a.key,a]));
  if(new Set(selected.map(a=>a.key)).size!==selected.length)throw new Error("An asset was selected twice.");
  for(const a of selected){const latest=current.get(a.key);if(!latest||latest.id!==a.id||latest.kind!==a.kind||latest.owner_id!==a.owner_id||latest.unavailable||![recipient,data.viewer_owner_id].includes(latest.owner_id))throw new Error("A selected asset changed ownership or is unavailable. Rebuild this offer.");}
  return {request_id:requestId,action:"propose",args:{recipient_id:recipient,assets:selected.map(a=>({from_owner_id:a.owner_id,...(a.kind==="player"?{player_id:a.id}:{pick_id:a.id})}))}};
}
export function tradeWarnings(data:TradeRoster,recipient:string,selected:TradeAsset[]){
  return [data.viewer_owner_id,recipient].flatMap(owner=>{
    const count=data.players.filter(p=>p.owner_id===owner).length-selected.filter(a=>a.kind==="player"&&a.owner_id===owner).length+selected.filter(a=>a.kind==="player"&&a.owner_id!==owner).length;
    return count>65?[`${data.owners.find(o=>o.id===owner)?.name}: roster would have ${count} players (65-player limit).`]:[];
  });
}
