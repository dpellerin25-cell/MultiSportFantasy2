"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {createClient,type SupabaseClient,type Session} from "@supabase/supabase-js";
import {proposal,tradeAssets,tradeWarnings,activeOffers,archivedOffers,canRespond,offerResponse,counterSelection,counterProposal,type Offer,type TradeCommand,type TradeAsset,type TradeRoster} from "@/lib/trade-model";

type LocalRoster={owner:string;sports:{sport:string;league_id?:string;players:{player_id:string|null;name:string|null;position:string|null;pro_team:string|null}[]}[]};
const button="min-h-11 rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-40";
const secondary="min-h-11 rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-40";
const Context=createContext<{data:TradeRoster;open:(id:string)=>void}|null>(null);
const url=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL;
const key=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY;
const configured=url==="https://tgvuntuhdqucazpoxrrg.supabase.co"&&key?.startsWith("sb_publishable_");

export function ProposeTradeButton({owner}:{owner:string}){
  const ctx=useContext(Context);const other=ctx?.data.owners.find(o=>o.name===owner);
  if(!ctx||!other||other.id===ctx.data.viewer_owner_id)return null;
  return <button className={button} onClick={()=>ctx.open(other.id)}>Propose Trade</button>;
}
function Modal({title,onClose,locked=false,children}:{title:string;onClose:()=>void;locked?:boolean;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
  return <dialog ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();if(!locked)onClose();}} className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-6xl overflow-y-auto rounded-2xl border border-blue-100 bg-blue-50 p-4 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 sm:p-6">{children}</dialog>;
}
export function Trades({children,rosters}:{children:ReactNode;rosters:LocalRoster[]}){
  const [client,setClient]=useState<SupabaseClient|null>(null),[session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!configured)return;
    const c=createClient(url!,key!,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:"multisport-draft-test-auth"}});
    let active=true;
    const {data}=c.auth.onAuthStateChange((_event,s)=>{if(active){setClient(c);setSession(s);setReady(true);}});
    c.auth.getSession().then(({data,error})=>{if(active){setClient(c);setSession(data.session);setReady(true);if(error)setError("Could not check your sign-in. Please refresh.");}});
    return()=>{active=false;data.subscription.unsubscribe();};
  },[]);
  if(!configured)return <><p className="mb-4 rounded-xl bg-white p-4 text-sm text-slate-600">Trade proposals will be available after the league connection is enabled.</p>{children}</>;
  if(!ready||!client)return <><p role="status" className="mb-4">Checking owner sign-in…</p>{children}</>;
  if(session)return <TradeWorkspace key={session.user.id} client={client} rosters={rosters}>{children}</TradeWorkspace>;
  return <><section className="mb-6 rounded-xl border border-blue-100 bg-white p-4 sm:p-5"><h2 className="text-lg font-bold">Sign in to propose a trade</h2><p className="mt-1 text-sm text-slate-600">Use the same owner account as the draft room. You can still browse every roster below.</p><form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError("");const form=new FormData(e.currentTarget);try{const {error}=await client.auth.signInWithPassword({email:String(form.get("email")).trim(),password:String(form.get("password"))});if(error)setError("Sign-in failed. Check your email and password.");}catch{setError("Could not connect. Please try again.");}finally{setBusy(false);}}}>
    <label className="text-sm font-semibold">Email<input className="mt-1 block min-h-11 rounded-lg border border-slate-300 px-3" name="email" type="email" autoComplete="username" required/></label>
    <label className="text-sm font-semibold">Password<input className="mt-1 block min-h-11 rounded-lg border border-slate-300 px-3" name="password" type="password" autoComplete="current-password" required/></label>
    <button className={button} disabled={busy}>{busy?"Signing in…":"Sign in"}</button></form>{error&&<p role="alert" className="mt-3 text-red-800">{error}</p>}</section>{children}</>;
}
function TradeWorkspace({client,rosters,children}:{client:SupabaseClient;rosters:LocalRoster[];children:ReactNode}){
  const [data,setData]=useState<TradeRoster|null>(null),[offers,setOffers]=useState<Offer[]>([]),[recipient,setRecipient]=useState<string|null>(null),[selection,setSelection]=useState<TradeAsset[]>([]),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const loadVersion=useRef(0);
  const sending=useRef(false),pending=useRef<TradeCommand|null>(null),responsePending=useRef<TradeCommand|null>(null),[uncertain,setUncertain]=useState(false);
  const [counter,setCounter]=useState<Offer|null>(null),[decision,setDecision]=useState<{offer:Offer;action:"accept"|"decline"}|null>(null);
  useEffect(()=>{
    let active=true,inFlight=false;
    const load=async()=>{if(inFlight||sending.current||pending.current||responsePending.current)return;inFlight=true;const version=++loadVersion.current;try{const [r,l]=await Promise.all([client.rpc("trade_rosters"),client.rpc("trade_list")]);if(!active||sending.current||version!==loadVersion.current)return;if(r.error||l.error){setError("Could not load trade data. Refresh trades to try again.");return;}setData(r.data);setOffers(l.data);}catch{if(active)setError("Could not connect to trades. Please refresh.");}finally{inFlight=false;}};
    void load();const timer=setInterval(()=>{if(document.visibilityState==="visible")void load();},30000);
    window.addEventListener("focus",load);return()=>{active=false;clearInterval(timer);window.removeEventListener("focus",load);};
  },[client]);
  const close=()=>{if(sending.current||uncertain)return;setRecipient(null);setSelection([]);setReview(false);setCounter(null);pending.current=null;setError("");};
  async function refresh(){const version=++loadVersion.current;setError("");const [r,l]=await Promise.all([client.rpc("trade_rosters"),client.rpc("trade_list")]);if(version!==loadVersion.current)return;if(r.error||l.error){setError("Could not refresh trades. Please try again.");return;}setData(r.data);setOffers(l.data);}
  async function send(){
    if(!data||!recipient||sending.current)return;
    sending.current=true;++loadVersion.current;setBusy(true);setError("");
    try{
      // Freeze the payload after the first send. A lost response retries the same request.
      pending.current??=counter?counterProposal(data,counter,selection,crypto.randomUUID()):proposal(data,recipient,selection,crypto.randomUUID());
      const {data:result,error}=await client.rpc("trade_command",pending.current);
      if(error){
        const definite=["P0001","23505","42501","22P02"].includes(error.code);
        setUncertain(!definite);if(definite)pending.current=null;
        setError(definite?"The offer could not be sent. An asset or account may have changed; cancel and refresh before trying again.":"We could not confirm whether the offer was saved. Retry Send Trade Offer to check safely; do not create another offer.");return;
      }
      if(!result?.trade_id)throw new Error("Missing confirmation");
      const name=data.owners.find(o=>o.id===recipient)?.name;
      setNotice(`${counter?"Counteroffer":"Trade offer"} sent to ${name}. It expires in seven days. Email notifications are not enabled yet.`);
      setRecipient(null);setSelection([]);setReview(false);setCounter(null);pending.current=null;setUncertain(false);
      void refresh().catch(()=>setError("Offer saved, but the list could not refresh. Use Refresh trades."));
    }catch{setUncertain(Boolean(pending.current));setError("Could not confirm the offer. Retry Send Trade Offer to check the same request safely.");}
    finally{sending.current=false;setBusy(false);}
  }
  function beginCounter(offer:Offer){
    if(!data||sending.current||uncertain)return;
    try{const selected=counterSelection(data,offer);setCounter(offer);setRecipient(offer.proposer_id);setSelection(selected);setReview(false);setError("");setNotice("");pending.current=null;}catch(e){setError(e instanceof Error?e.message:"Could not open counteroffer.");}
  }
  async function respond(){
    if(!data||!decision||sending.current)return;
    sending.current=true;++loadVersion.current;setBusy(true);setError("");
    try{
      responsePending.current??=offerResponse(decision.offer,data.viewer_owner_id,decision.action,crypto.randomUUID());
      const {data:result,error}=await client.rpc("trade_command",responsePending.current);
      if(error){const definite=["P0001","23505","42501","22P02"].includes(error.code);setUncertain(!definite);if(definite)responsePending.current=null;setError(definite?"The offer changed or is no longer available. Close this dialog and refresh trades.":"The result is unconfirmed. Retry this action to check the same request safely.");return;}
      if(!result?.trade_id)throw new Error("Unconfirmed response");
      window.dispatchEvent(new Event("rookie-picks-changed"));
      setOffers(old=>old.map(o=>o.id===result.trade_id?{...o,status:result.status,revision:result.revision}:o));
      setNotice(decision.action==="decline"?"Offer declined and archived.":result.status==="completed"?"Trade accepted. Picks transferred and the completed trade archived.":"Trade accepted. Picks transferred; the agreement remains visible until Fantrax confirms every player move.");
      setDecision(null);responsePending.current=null;setUncertain(false);
      void refresh().catch(()=>setError("Saved successfully, but the list could not refresh. Use Refresh trades."));
    }catch(e){setUncertain(Boolean(responsePending.current));setError(responsePending.current?"The result is unconfirmed. Retry this action safely.":e instanceof Error?e.message:"Could not respond.");}
    finally{sending.current=false;setBusy(false);}
  }
  const assets=data?tradeAssets(data):[],ownerName=(id:string)=>data?.owners.find(o=>o.id===id)?.name??"Owner";
  const visibleOffers=data?activeOffers(offers,data.viewer_owner_id):[];
  const proposals=visibleOffers.filter(o=>o.status==="proposed");
  const acceptedTrades=visibleOffers.filter(o=>o.status==="accepted");
  const archived=data?archivedOffers(offers,data.viewer_owner_id):[];
  function column(ownerId:string){
    const local=rosters.find(o=>o.owner===ownerName(ownerId));
    const dbPlayers=assets.filter(a=>a.owner_id===ownerId&&a.kind==="player");
    const missing:TradeAsset[]=[];
    for(const s of local?.sports??[])for(const p of s.players){
      const found=data!.players.find(x=>x.fantrax_id===p.player_id&&x.league_id===s.league_id);
      if(!found)missing.push({key:`missing:${s.sport}:${p.player_id??p.name}`,id:"",kind:"player",owner_id:ownerId,label:p.name??"Unknown player",sport:s.sport==="Premier League"?"EPL":s.sport,unavailable:"Awaiting trade roster sync"});
    }
    const playerRows=[...dbPlayers,...missing];
    const row=(a:TradeAsset)=>{const selected=selection.some(s=>s.key===a.key);return <li key={a.key} className={`flex items-center justify-between gap-3 border-b border-blue-50 px-4 py-3 last:border-0 ${selected?"bg-blue-50":""}`}><div className="min-w-0"><p className="font-medium">{a.label}</p>{a.unavailable&&<p className="text-xs text-slate-500">{a.unavailable}</p>}</div><button className={selected?secondary:button} disabled={!!a.unavailable} aria-pressed={selected} aria-label={`${selected?"Remove":"Trade"} ${a.label}`} onClick={()=>setSelection(old=>selected?old.filter(x=>x.key!==a.key):[...old,a])}>{selected?"Remove":"Trade"}</button></li>;};
    return <section className="min-w-0 overflow-hidden rounded-xl border border-blue-100 bg-white"><header className="sticky top-0 z-10 border-b border-blue-100 bg-white p-4"><h3 className="text-xl font-bold">{ownerName(ownerId)} {ownerId===data?.viewer_owner_id&&<span className="text-sm font-normal text-blue-700">(You)</span>}</h3><p className="text-sm text-slate-600">{selection.filter(a=>a.owner_id===ownerId).length} selected</p></header><div className="md:max-h-[52dvh] md:overflow-y-auto">{["NFL","MLB","NBA","EPL","PGA"].map(sport=><section key={sport}><h4 className="bg-slate-50 px-4 py-2 text-sm font-bold text-blue-900">{sport}</h4>{playerRows.some(a=>a.sport===sport)?<ul>{playerRows.filter(a=>a.sport===sport).map(row)}</ul>:<p className="px-4 py-3 text-sm text-slate-500">No players</p>}</section>)}<h4 className="bg-slate-50 px-4 py-2 text-sm font-bold text-blue-900">Rookie draft picks</h4><ul>{assets.filter(a=>a.owner_id===ownerId&&a.kind==="pick").map(row)}</ul></div></section>;
  }
  return <Context.Provider value={data?{data,open:id=>{setCounter(null);setRecipient(id);setSelection([]);setError("");setNotice("");}}:null}>
    <section className="mb-6 rounded-xl border border-blue-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Trade proposals {data&&`· ${ownerName(data.viewer_owner_id)}`}</h2><p className="mt-1 text-sm text-slate-600">Test league · Choose another owner to build an offer. Email notifications are not enabled yet.</p></div><div className="flex gap-2"><button className={secondary} onClick={()=>void refresh()}>Refresh trades</button><button className={secondary} onClick={()=>void client.auth.signOut({scope:"local"})}>Sign out</button></div></div>{!data&&!error&&<p role="status">Loading trade rosters…</p>}{error&&!recipient&&<p role="alert" className="mt-3 text-red-800">{error}</p>}{notice&&<p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-blue-900">{notice}</p>}
    {data&&acceptedTrades.length>0&&<section className="mt-4 border-t border-blue-100 pt-4" aria-label="Accepted trades awaiting Fantrax">
      <h3 className="font-bold text-blue-900">Accepted Trades ({acceptedTrades.length})</h3>
      <p className="mt-2 text-sm text-slate-600">Website rosters automatically update every morning at 4 a.m. Eastern. If a trade needs to be pushed through right away, contact Doug.</p>
      <div className="mt-3 space-y-3">{acceptedTrades.map(o=><article key={o.id} className="rounded-lg border border-blue-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{ownerName(o.proposer_id)} ↔ {ownerName(o.recipient_id)}</p><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{o.status==="accepted"?(o.corrected_at?"Reversal awaiting Fantrax":"Accepted · Awaiting Fantrax"):o.recipient_id===data.viewer_owner_id?"Received proposal":"Sent proposal"}</span></div>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">{o.assets.map((a,i)=><li key={i}>{ownerName(o.corrected_at?a.to_owner_id:a.from_owner_id)} sends <strong>{assets.find(x=>x.id===(a.player_id??a.pick_id))?.label??"Previously recorded asset"}</strong> to {ownerName(o.corrected_at?a.from_owner_id:a.to_owner_id)}</li>)}</ul>
        <div className="mt-4 rounded-lg border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-bold">Fantrax action required</p><p className="mt-1 font-medium">Move the listed players on Fantrax. This trade will leave the list after a roster import confirms all player transfers.</p></div>
      </article>)}</div>
    </section>}
    {data&&<details className="mt-4">
      <summary className="cursor-pointer font-semibold text-blue-800">Your Offers ({proposals.length})</summary>
      <p className="mt-2 text-sm text-slate-600">Your sent and received proposals. Closed proposals are archived automatically.</p>
      <div className="mt-3 space-y-3">{proposals.map(o=><article key={o.id} className="rounded-lg border border-blue-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{ownerName(o.proposer_id)} ↔ {ownerName(o.recipient_id)}</p><span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800">{o.status==="accepted"?(o.corrected_at?"Reversal awaiting Fantrax":"Accepted · Awaiting Fantrax"):o.recipient_id===data.viewer_owner_id?"Received proposal":"Sent proposal"}</span></div>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">{o.assets.map((a,i)=><li key={i}>{ownerName(o.corrected_at?a.to_owner_id:a.from_owner_id)} sends <strong>{assets.find(x=>x.id===(a.player_id??a.pick_id))?.label??"Previously recorded asset"}</strong> to {ownerName(o.corrected_at?a.from_owner_id:a.to_owner_id)}</li>)}</ul>
        <p className="mt-3 text-xs text-slate-500">Expires {new Date(o.expires_at).toLocaleString()}</p>
        {canRespond(o,data.viewer_owner_id)&&<div className="mt-4 flex flex-wrap gap-2">
          <button className={button} disabled={busy||uncertain} onClick={()=>{setDecision({offer:o,action:"accept"});setError("");}}>Accept</button>
          <button className={secondary} disabled={busy||uncertain} onClick={()=>{setDecision({offer:o,action:"decline"});setError("");}}>Decline</button>
          <button className={secondary} disabled={busy||uncertain} onClick={()=>beginCounter(o)}>Counter Offer</button>
        </div>}
      </article>)}{proposals.length===0&&<p className="text-sm text-slate-600">No active trade proposals.</p>}</div>
    </details>}
    {data&&<details className="mt-4 border-t border-blue-100 pt-4">
      <summary className="cursor-pointer font-semibold text-blue-800">Archived ({archived.length})</summary>
      <p className="mt-2 text-sm text-slate-600">Completed league trades and your closed proposals. Unaccepted proposals remain private to the owners involved.</p>
      <div className="mt-3 space-y-3">{archived.map(o=><article key={o.id} className="rounded-lg border border-blue-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{ownerName(o.proposer_id)} ↔ {ownerName(o.recipient_id)}</p><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">{o.corrected_at?"Reversed · Completed":o.status==="proposed"?"Expired":o.status}</span></div>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">{o.assets.map((a,i)=><li key={i}>{ownerName(a.from_owner_id)} → {ownerName(a.to_owner_id)}: <strong>{assets.find(x=>x.id===(a.player_id??a.pick_id))?.label??"Previously recorded asset"}</strong></li>)}</ul>
        {o.corrected_at&&<p className="mt-3 text-sm text-slate-600">The original agreement shown above was reversed by the commissioner.</p>}
      </article>)}{archived.length===0&&<p className="text-sm text-slate-600">No archived trades yet.</p>}</div>
    </details>}</section>
    {children}
    {decision&&data&&<Modal title={decision.action==="accept"?"Accept trade offer":"Decline trade offer"} locked={busy||uncertain} onClose={()=>{if(!busy&&!uncertain){setDecision(null);responsePending.current=null;setError("");}}}>
      <h2 className="text-2xl font-bold">{decision.action==="accept"?"Accept trade offer?":"Decline trade offer?"}</h2>
      <ul className="my-4 space-y-2">{decision.offer.assets.map((a,i)=><li key={i}>{ownerName(a.from_owner_id)} sends {assets.find(x=>x.id===(a.player_id??a.pick_id))?.label??"Previously recorded asset"} to {ownerName(a.to_owner_id)}</li>)}</ul>
      <p className="mb-4 text-sm text-slate-600">{decision.action==="accept"?"Acceptance finalizes the agreement immediately. Picks move now. Players must be moved on Fantrax; the trade stays visible until those moves are confirmed. Picks-only trades complete and archive immediately.":"Declining closes and archives this proposal. No players or picks will move."}</p>
      {error&&<p role="alert" className="mb-4 text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>void respond()}>{busy?"Saving…":decision.action==="accept"?"Confirm Acceptance":"Confirm Decline"}</button><button className={secondary} disabled={busy||uncertain} onClick={()=>{setDecision(null);responsePending.current=null;setError("");}}>Keep Reviewing</button></div>
    </Modal>}
    {recipient&&data&&<Modal title="Propose a trade" onClose={close} locked={busy||uncertain}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">{counter?"Counter offer":"Propose a trade"}</h2><p className="text-sm text-slate-600">{counter?"Adjust the original offer. It stays open until you send this counteroffer.":"Choose players and picks from either roster."}</p></div><button className={secondary} disabled={busy||uncertain} onClick={close}>Cancel Trade Offer</button></div>
      {!data.owners.find(o=>o.id===recipient)?.can_receive&&<p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3">This owner needs a linked account before they can receive offers.</p>}
      {!data.ledger_ready&&<p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3">Trade picks haven’t been set up yet.</p>}
      <div className="grid items-start gap-4 md:grid-cols-2">{column(data.viewer_owner_id)}{column(recipient)}</div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm font-semibold">{selection.length} players / picks selected</p><button className={button} disabled={!selection.length||!data.ledger_ready||!data.owners.find(o=>o.id===recipient)?.can_receive} onClick={()=>setReview(true)}>View Trade Offer</button></div>
    </Modal>}
    {review&&recipient&&data&&<Modal title="Review trade offer" onClose={close} locked={busy||uncertain}><h2 className="text-2xl font-bold">{counter?"Review counteroffer":"Review trade offer"}</h2><div className="my-5 grid gap-4 md:grid-cols-2">{[data.viewer_owner_id,recipient].map(id=><section key={id} className="rounded-xl border border-blue-100 bg-white p-4"><h3 className="mb-3 font-bold">{ownerName(id)} sends</h3><ul className="space-y-2">{selection.filter(a=>a.owner_id===id).map(a=><li key={a.key}>{a.label}{a.sport&&<span className="ml-2 text-xs text-slate-500">{a.sport}</span>}</li>)}</ul>{!selection.some(a=>a.owner_id===id)&&<p className="text-sm text-slate-500">No assets selected on this side.</p>}</section>)}</div>{tradeWarnings(data,recipient,selection).length>0&&<details className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-semibold">Roster warnings (advisory only)</summary><p className="my-2">Based on the latest trade roster snapshot; these warnings do not prevent an offer.</p><ul>{tradeWarnings(data,recipient,selection).map(w=><li key={w}>{w}</li>)}</ul></details>}<p className="mb-4 text-sm text-slate-600">This offer is private to both owners and expires after seven days. Player moves are completed on Fantrax after acceptance.</p>{error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}<div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>void send()}>{busy?"Sending…":counter?"Send Counter Offer":"Send Trade Offer"}</button><button className={secondary} disabled={busy||uncertain} onClick={close}>Cancel Trade Offer</button></div></Modal>}
  </Context.Provider>;
}
