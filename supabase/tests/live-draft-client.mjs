// Injectable Supabase client; usable by the future UI without owning auth state.
// Broadcasts are invalidation hints. Always fetch authoritative RPC state again.
export function watchDraft(client,target,{onState,onError=()=>{}}){
  let stopped=false,busy=false,dirty=false;
  async function refresh(){
    dirty=true;if(busy||stopped)return;
    busy=true;
    try{while(dirty&&!stopped){dirty=false;const {data,error}=await client.rpc('draft_state',{target});
      if(error)throw error;if(!stopped)onState(data);
    }}catch(e){if(!stopped)onError(e);}finally{busy=false;}
  }
  const channel=client.channel(`draft-revisions:${target}`)
    .on('postgres_changes',{event:'*',schema:'draft',table:'live_updates',filter:`draft_id=eq.${target}`},refresh)
    .subscribe(status=>{
      if(status==='SUBSCRIBED')refresh(); // reconnect/missed-event recovery
      if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)&&!stopped)onError(new Error('Draft subscription disconnected; reconnecting/polling'));
    });
  const poll=setInterval(refresh,15000); // recovery if a signal is missed
  refresh();
  return {refresh,close:async()=>{stopped=true;clearInterval(poll);await client.removeChannel(channel);}};
}
