"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {createClient,type SupabaseClient,type Session} from "@supabase/supabase-js";
import {proposal,tradeAssets,tradeWarnings,type TradeAsset,type TradeRoster} from "@/lib/trade-model";

type LocalRoster={owner:string;sports:{sport:string;league_id?:string;players:{player_id:string|null;name:string|null;position:string|null;pro_team:string|null}[]}[]};
type Offer={id:string;proposer_id:string;recipient_id:string;status:string;expires_at:string;corrected_at:string|null;assets:{from_owner_id:string;player_id:string|null;pick_id:string|null}[]};
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
  const sending=useRef(false),pending=useRef<ReturnType<typeof proposal>|null>(null),[uncertain,setUncertain]=useState(false);
  useEffect(()=>{let active=true;Promise.all([client.rpc("trade_rosters"),client.rpc("trade_list")]).then(([r,l])=>{if(!active)return;if(r.error||l.error){setError("Trade data is not available yet. The trade roster update may need to be enabled. Your regular rosters are still available below.");return;}setData(r.data);setOffers(l.data);});return()=>{active=false;};},[client]);
  const close=()=>{if(sending.current||uncertain)return;setRecipient(null);setSelection([]);setReview(false);pending.current=null;setError("");};
  async function refresh(){setError("");const [r,l]=await Promise.all([client.rpc("trade_rosters"),client.rpc("trade_list")]);if(r.error||l.error){setError("Could not refresh trades. Please try again.");return;}setData(r.data);setOffers(l.data);}
  async function send(){
    if(!data||!recipient||sending.current)return;
    sending.current=true;setBusy(true);setError("");
    try{
      // Freeze the payload after the first send. A lost response retries the same request.
      pending.current??=proposal(data,recipient,selection,crypto.randomUUID());
      const {data:result,error}=await client.rpc("trade_command",pending.current);
      if(error){
        const definite=["P0001","23505","42501","22P02"].includes(error.code);
        setUncertain(!definite);if(definite)pending.current=null;
        setError(definite?"The offer could not be sent. An asset or account may have changed; cancel and refresh before trying again.":"We could not confirm whether the offer was saved. Retry Send Trade Offer to check safely; do not create another offer.");return;
      }
      if(!result?.trade_id)throw new Error("Missing confirmation");
      const name=data.owners.find(o=>o.id===recipient)?.name;
      setNotice(`Trade offer sent to ${name}. It is available in their offers below and expires in seven days. Email notifications are not enabled yet.`);
      setRecipient(null);setSelection([]);setReview(false);pending.current=null;setUncertain(false);
      void refresh().catch(()=>setError("Offer saved, but the list could not refresh. Use Refresh trades."));
    }catch{setUncertain(Boolean(pending.current));setError("Could not confirm the offer. Retry Send Trade Offer to check the same request safely.");}
    finally{sending.current=false;setBusy(false);}
  }
  const assets=data?tradeAssets(data):[],ownerName=(id:string)=>data?.owners.find(o=>o.id===id)?.name??"Owner";
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
  return <Context.Provider value={data?{data,open:id=>{setRecipient(id);setSelection([]);setError("");setNotice("");}}:null}>
    <section className="mb-6 rounded-xl border border-blue-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold">Trade proposals {data&&`· ${ownerName(data.viewer_owner_id)}`}</h2><p className="mt-1 text-sm text-slate-600">Test league · Choose another owner to build an offer. Email notifications are not enabled yet.</p></div><div className="flex gap-2"><button className={secondary} onClick={()=>void refresh()}>Refresh trades</button><button className={secondary} onClick={()=>void client.auth.signOut({scope:"local"})}>Sign out</button></div></div>{!data&&!error&&<p role="status">Loading trade rosters…</p>}{error&&!recipient&&<p role="alert" className="mt-3 text-red-800">{error}</p>}{notice&&<p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-blue-900">{notice}</p>}
    {data&&<details className="mt-4"><summary className="cursor-pointer font-semibold text-blue-800">Your offers ({offers.filter(o=>[o.proposer_id,o.recipient_id].includes(data.viewer_owner_id)).length})</summary><div className="mt-3 space-y-3">{offers.filter(o=>[o.proposer_id,o.recipient_id].includes(data.viewer_owner_id)).map(o=><article key={o.id} className="rounded-lg border border-blue-100 p-3"><p className="font-semibold">{ownerName(o.proposer_id)} → {ownerName(o.recipient_id)} · {o.corrected_at?"Reversed":o.status}</p><ul className="mt-1 text-sm text-slate-600">{o.assets.map((a,i)=><li key={i}>{ownerName(a.from_owner_id)} sends {assets.find(x=>x.id===(a.player_id??a.pick_id))?.label??"Previously recorded asset"}</li>)}</ul></article>)}{!offers.some(o=>[o.proposer_id,o.recipient_id].includes(data.viewer_owner_id))&&<p className="text-sm text-slate-600">No trade offers yet.</p>}</div></details>}</section>
    {children}
    {recipient&&data&&<Modal title="Propose a trade" onClose={close} locked={busy||uncertain}><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold">Propose a trade</h2><p className="text-sm text-slate-600">Choose players and picks from either roster.</p></div><button className={secondary} disabled={busy||uncertain} onClick={close}>Cancel Trade Offer</button></div>
      {!data.owners.find(o=>o.id===recipient)?.can_receive&&<p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3">This owner needs a linked account before they can receive offers.</p>}
      {!data.ledger_ready&&<p role="alert" className="mb-3 rounded-lg bg-amber-50 p-3">Trade picks haven’t been set up yet.</p>}
      <div className="grid items-start gap-4 md:grid-cols-2">{column(data.viewer_owner_id)}{column(recipient)}</div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-sm font-semibold">{selection.length} players / picks selected</p><button className={button} disabled={!selection.length||!data.ledger_ready||!data.owners.find(o=>o.id===recipient)?.can_receive} onClick={()=>setReview(true)}>View Trade Offer</button></div>
    </Modal>}
    {review&&recipient&&data&&<Modal title="Review trade offer" onClose={close} locked={busy||uncertain}><h2 className="text-2xl font-bold">Review trade offer</h2><div className="my-5 grid gap-4 md:grid-cols-2">{[data.viewer_owner_id,recipient].map(id=><section key={id} className="rounded-xl border border-blue-100 bg-white p-4"><h3 className="mb-3 font-bold">{ownerName(id)} sends</h3><ul className="space-y-2">{selection.filter(a=>a.owner_id===id).map(a=><li key={a.key}>{a.label}{a.sport&&<span className="ml-2 text-xs text-slate-500">{a.sport}</span>}</li>)}</ul>{!selection.some(a=>a.owner_id===id)&&<p className="text-sm text-slate-500">No assets selected on this side.</p>}</section>)}</div>{tradeWarnings(data,recipient,selection).length>0&&<details className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><summary className="cursor-pointer font-semibold">Roster warnings (advisory only)</summary><p className="my-2">Based on the latest trade roster snapshot; these warnings do not prevent an offer.</p><ul>{tradeWarnings(data,recipient,selection).map(w=><li key={w}>{w}</li>)}</ul></details>}<p className="mb-4 text-sm text-slate-600">This offer is private to both owners and expires after seven days. Player moves are completed on Fantrax after acceptance.</p>{error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}<div className="flex flex-wrap gap-3"><button className={button} disabled={busy} onClick={()=>void send()}>{busy?"Sending…":"Send Trade Offer"}</button><button className={secondary} disabled={busy||uncertain} onClick={close}>Cancel Trade Offer</button></div></Modal>}
  </Context.Provider>;
}
