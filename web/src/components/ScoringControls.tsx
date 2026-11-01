"use client";
import {useEffect,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {leagueSettingsClient,leagueSettingsConfigured} from '@/lib/league-settings-client';
import {canReviewPga,checkpointLabel,scoringRequest,validateReason,type ControlsState,type PgaResult,type PgaReview,type Review} from '@/lib/scoring-controls-model';
const panel='rounded-xl border border-blue-100 bg-white p-5 shadow-sm';
const button='min-h-11 rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white disabled:opacity-40';
const secondary='min-h-11 rounded-lg border border-blue-200 px-4 py-2 font-semibold text-blue-800 disabled:opacity-40';
const field='w-full rounded-lg border border-slate-300 bg-white p-3';
const time=(value:string|null)=>value?new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'})+' ET':'—';
export default function ScoringControls(){
 const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false);
 useEffect(()=>{const c=leagueSettingsClient();if(!c)return;const {data}=c.auth.onAuthStateChange((_event,s)=>{setSession(s);setReady(true);});return()=>data.subscription.unsubscribe();},[]);
 if(!leagueSettingsConfigured)return <p className={panel}>The league database connection is not configured.</p>;
 if(!ready)return <p role="status">Checking owner sign-in…</p>;
 if(!session)return <p className={panel}>Sign in using the option at the top right. Only an active commissioner can access Scoring Controls.</p>;
 return <Editor key={session.user.id} client={leagueSettingsClient()!}/>;
}
function Editor({client}:{client:SupabaseClient}){
 const [state,setState]=useState<ControlsState|null>(null),[day,setDay]=useState(''),[test,setTest]=useState(false),[historyPage,setHistoryPage]=useState(0),[pgaPage,setPgaPage]=useState(0);
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[review,setReview]=useState<Review|null>(null),[confirmed,setConfirmed]=useState(false),[uncertain,setUncertain]=useState(false);
 const sending=useRef(false),pending=useRef<ReturnType<typeof scoringRequest>|null>(null),reviewPanel=useRef<HTMLElement>(null);
 const locked=busy||uncertain;
 async function load(){const {data,error}=await client.rpc('scoring_controls_state',{check_day:day||null,history_page:historyPage,pga_page:pgaPage,include_test:test});if(error)throw Error(error.code==='42501'?'Commissioner access required.':'Unable to load Scoring Controls. Check the connection and scoring-controls migration.');setState(data);}
 useEffect(()=>{let live=true;setError('');setState(null);void client.rpc('scoring_controls_state',{check_day:day||null,history_page:historyPage,pga_page:pgaPage,include_test:test}).then(({data,error})=>{if(!live)return;if(error)setError(error.code==='42501'?'Commissioner access required.':'Unable to load Scoring Controls. Check the connection and scoring-controls migration.');else setState(data);});return()=>{live=false;};},[client,day,historyPage,pgaPage,test]);
 useEffect(()=>{if(review)reviewPanel.current?.focus();},[review]);
 function resetReview(){setReview(null);setConfirmed(false);setError('');setNotice('');}
 function pauseReview(){if(!state||locked)return;try{resetReview();setReview({kind:'pause',paused:!state.pause.paused,expected:state.pause.id,reason:validateReason(reason)});}catch(e){setError((e as Error).message);}}
 async function pgaReview(result:PgaResult,choice:'enforce'|'waive'){
  if(sending.current||uncertain)return;sending.current=true;setBusy(true);resetReview();
  try{const explanation=validateReason(reason);const {data,error}=await client.rpc('scoring_controls_pga_review',{result_id:result.result_id});if(error)throw Error(error.message);setReview({kind:'pga',choice,result,evidence:data as PgaReview,reason:explanation});}catch(e){setError(e instanceof Error?e.message:'Unable to review this result.');}finally{sending.current=false;setBusy(false);}
 }
 async function apply(){
  if(!review||sending.current)return;sending.current=true;setBusy(true);setError('');
  try{
   pending.current??=scoringRequest(review,confirmed,crypto.randomUUID());
   const {data,error}=await client.rpc(pending.current.rpc,pending.current.args);
   if(error){if(['P0001','42501','22023','22P02','23514','23502'].includes(error.code)){pending.current=null;setUncertain(false);setReview(null);setConfirmed(false);throw Error(error.message+' Refresh and review again.');}throw Error('Result unconfirmed. Use Retry Same Change below; do not submit another action.');}
   if(!data?.event_id&&!data?.resolution_id)throw Error('Result unconfirmed. Retry the same change.');
   pending.current=null;setUncertain(false);setReview(null);setConfirmed(false);setReason('');setNotice('Change saved in the audit history. Published standings have not been changed.');await load();
  }catch(e){if(pending.current)setUncertain(true);setError(e instanceof Error?e.message:'Connection interrupted. Retry the same change.');}finally{sending.current=false;setBusy(false);}
 }
 return <div className="space-y-5">
 {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-900">{error}</p>}
 {notice&&<p role="status" className="rounded-lg bg-green-50 p-4 text-green-900">{notice}</p>}
 {!state?<p role="status">{error?'No scoring data is available to this session.':'Loading scoring controls…'}</p>:<>
 <p className="text-sm text-slate-600">Test league connection · Times shown in Eastern time. Pause controls apply across all sports.</p>
 {review&&<section ref={reviewPanel} tabIndex={-1} aria-label="Review scoring change" className={`${panel} border-amber-300 bg-amber-50`}><h2 className="text-xl font-bold">Review before applying</h2>
 {review.kind==='pause'?<p className="mt-3">{review.paused?'Pause':'Resume'} roster-overage penalties from the time this change is saved. Existing decisions and roster evidence are preserved.</p>:<><p className="mt-3">{review.result.owner} · PGA · {review.result.start_date}–{review.result.end_date}{review.result.is_test?' · Historical test data':''}</p><p>{review.choice==='waive'?'Waive this tournament penalty':'Apply the standard two-check PGA rule'}. Result: <strong>{review.choice==='waive'?review.evidence.waive_total:review.evidence.enforce_total} points</strong>.</p><p className="mt-2 text-sm">Over cap at {review.evidence.overage_checks} of 2 checks. Negative starter contributions ({review.evidence.negative_points}) remain. This does not waive unknown scores or missing roster evidence.</p></>}
 <p className="mt-3"><strong>Reason:</strong> {review.reason}</p><label className="my-4 flex gap-3"><input type="checkbox" checked={confirmed} disabled={locked} onChange={e=>setConfirmed(e.target.checked)}/><span>I confirm this change and its effect on roster-overage penalties.</span></label>
 <div className="flex flex-wrap gap-3"><button className={button} disabled={busy||(!confirmed&&!uncertain)} onClick={()=>void apply()}>{busy?'Saving…':uncertain?'Retry Same Change':'Confirm and Apply'}</button><button className={secondary} disabled={locked} onClick={resetReview}>Cancel</button></div></section>}
 <fieldset disabled={locked} className="min-w-0 space-y-5">
 <section className={panel}><h2 className="text-xl font-bold">Roster-overage penalties: {state.pause.paused?'Paused':'Active'}</h2><p className="mt-2">Last change: {time(state.pause.effective_at)}</p>{state.pause.reason&&<p className="text-slate-600">{state.pause.reason}</p>}<p className="mt-3 text-sm text-slate-600">A pause preserves roster counts. PGA tournaments that span a pause change may require an individual decision below.</p>
 <label className="mt-4 block font-semibold">Reason for your next change<textarea className={`${field} mt-2`} value={reason} minLength={5} maxLength={1000} rows={3} onChange={e=>{setReason(e.target.value);resetReview();}} placeholder="Explain the pause, resumption, or PGA decision."/></label><button className={`${button} mt-3`} onClick={pauseReview}>{state.pause.paused?'Review Resume Penalties':'Review Pause Roster Overage Penalties'}</button></section>
 <section className={panel}><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-xl font-bold">Daily roster evidence</h2><label>Check date<input type="date" className={`${field} mt-1`} value={day||state.check_date} onChange={e=>{resetReview();setDay(e.target.value);}}/></label></div><p className="mt-3 text-sm text-slate-600">A complete checkpoint supplies the previous day’s daily eligibility evidence. PGA uses Thursday and Sunday. Counts alone do not prove scoring is final.</p>
 <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Owner</th><th className="p-2">Status</th><th className="p-2">Players / cap</th><th className="p-2">Observed</th></tr></thead><tbody>{state.checks.map(c=><tr key={c.owner_id} className="border-t border-blue-100"><th className="p-2">{c.owner}</th><td className="p-2">{checkpointLabel(c)}{!c.complete&&<p className="text-xs text-slate-500">{c.reason||`Last recorded check: ${c.last_check_date||'None'}`}</p>}</td><td className="p-2">{c.total_players??'—'} / {c.cap??'—'}</td><td className="p-2">{time(c.checked_at)}</td></tr>)}</tbody></table></div></section>
 <section className={panel}><h2 className="text-xl font-bold">PGA tournament decisions</h2><label className="my-3 flex gap-2"><input type="checkbox" checked={test} onChange={e=>{resetReview();setTest(e.target.checked);setPgaPage(0);setHistoryPage(0);}}/>Show historical test results instead of championship results</label><p className="text-sm text-slate-600">Only tournaments affected by a pause boundary can be resolved here. Missing evidence stays pending.</p>
 {!state.pga.length&&<p className="mt-4">No {test?'test':'championship'} PGA results on this page.</p>}
 {state.pga.map(r=><article key={r.result_id} className="mt-4 rounded-lg border border-blue-100 p-4"><h3 className="font-bold">{r.owner} · {r.label}</h3><p className="text-sm">{r.start_date}–{r.end_date} · {r.is_test?'Historical test data':`Cup ${r.championship_year}`} · Revision {r.revision}</p><p className="mt-2">{r.outcome.status}: {r.outcome.reason}</p>{canReviewPga(r.outcome)&&<div className="mt-3 flex flex-wrap gap-3"><button className={secondary} onClick={()=>void pgaReview(r,'enforce')}>Review Standard Penalty</button><button className={secondary} onClick={()=>void pgaReview(r,'waive')}>Review Waiver</button></div>}</article>)}
 <div className="mt-4 flex gap-3"><button className={secondary} disabled={pgaPage===0} onClick={()=>{resetReview();setPgaPage(pgaPage-1);}}>Previous tournaments</button><button className={secondary} disabled={!state.pga_has_more} onClick={()=>{resetReview();setPgaPage(pgaPage+1);}}>Next tournaments</button></div></section>
 <section className={panel}><h2 className="text-xl font-bold">Commissioner decision history</h2><p className="mt-2 text-sm text-slate-600">All pause changes, plus {test?'historical test':'championship'} PGA decisions. Earlier decisions remain recorded after corrections.</p>{!state.history.length&&<p className="mt-4">No decisions recorded on this page.</p>}<ul className="mt-3 divide-y divide-blue-100">{state.history.map(h=><li key={h.id} className="py-3"><p className="font-semibold">{h.actor}: {h.action}{h.owner?` · ${h.owner} · ${h.start_date}–${h.end_date}`:''}{h.is_test?' · Test data':''}</p><p className="text-sm text-slate-500">{time(h.occurred_at)}</p><p className="mt-1 whitespace-pre-wrap">{h.reason}</p></li>)}</ul><div className="mt-3 flex gap-3"><button className={secondary} disabled={historyPage===0} onClick={()=>{resetReview();setHistoryPage(historyPage-1);}}>Previous history</button><button className={secondary} disabled={!state.history_has_more} onClick={()=>{resetReview();setHistoryPage(historyPage+1);}}>Next history</button></div></section>
 <button className={secondary} onClick={()=>{resetReview();setBusy(true);void load().catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Refresh Scoring Controls</button>
 </fieldset></>}
 </div>;
}
