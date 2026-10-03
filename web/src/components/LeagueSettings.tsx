"use client";
import {useEffect,useRef,useState} from 'react';
import type {Session,SupabaseClient} from '@supabase/supabase-js';
import {leagueSettingsClient,leagueSettingsConfigured} from '@/lib/league-settings-client';
import {settingsInput,settingsRequest,type Member,type SettingsState,type SettingsInput,type SettingsPreview} from '@/lib/league-settings-model';
const button='min-h-11 rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white hover:bg-blue-900 disabled:opacity-40';
const secondary='min-h-11 rounded-lg border border-blue-200 px-4 py-2 font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-40';
const field='min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2';
const panel='rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-6';
export default function LeagueSettings(){
 const [client,setClient]=useState<SupabaseClient|null>(null),[ready,setReady]=useState(false),[session,setSession]=useState<Session|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  const c=leagueSettingsClient();if(!c)return;
  const {data}=c.auth.onAuthStateChange((_e,s)=>{setClient(c);setSession(s);setReady(true);});
  return()=>data.subscription.unsubscribe();
 },[]);
 if(!leagueSettingsConfigured)return <p className={panel}>League Settings requires the test league connection to be enabled.</p>;
 if(!ready)return <p role="status">Checking owner sign-in…</p>;
 if(!client)return <p className={panel}>League Settings requires the test league connection to be enabled.</p>;
 if(session)return <Editor key={session.user.id} client={client}/>;
 return <section className={panel}><h2 className="text-xl font-bold">Commissioner sign-in</h2><p className="mt-2 text-slate-600">Use your existing owner account. Only an active commissioner can access these settings.</p>
 <form className="mt-4 grid max-w-md gap-4" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');const f=new FormData(e.currentTarget);try{const result=await client.auth.signInWithPassword({email:String(f.get('email')).trim(),password:String(f.get('password'))});if(result.error)setError('Sign-in failed. Check your email and password.');}catch{setError('Unable to connect. Try again.');}finally{setBusy(false);}}}>
 <label>Email<input className={field} name="email" type="email" autoComplete="username" required/></label><label>Password<input className={field} name="password" type="password" autoComplete="current-password" required/></label><button className={button} disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form>{error&&<p role="alert" className="mt-3 text-red-800">{error}</p>}</section>;
}
function Editor({client}:{client:SupabaseClient}){
 const [state,setState]=useState<SettingsState|null>(null),[members,setMembers]=useState<Member[]>([]),[points,setPoints]=useState<string[]>([]);
 const [error,setError]=useState(''),[denied,setDenied]=useState(false),[busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false),[notice,setNotice]=useState('');
 const [review,setReview]=useState<{input:SettingsInput;preview:SettingsPreview}|null>(null),[uncertain,setUncertain]=useState(false);
 const [newName,setNewName]=useState(''),[newSlug,setNewSlug]=useState('');
 const sending=useRef(false),pending=useRef<ReturnType<typeof settingsRequest>|null>(null);
 function receive(s:SettingsState){setState(s);setMembers(s.owners.filter(o=>o.active).map(({slug,name})=>({slug,name})));setPoints(s.season.placement_points.map(String));setReview(null);setConfirmed(false);}
 useEffect(()=>{let live=true;void client.rpc('league_settings_state').then(({data,error})=>{if(!live)return;if(error){setDenied(error.code==='42501');setError(error.code==='42501'?'Commissioner access required.':'Unable to load settings. The League Settings migration may need to be applied to the test project.');}else receive(data);});return()=>{live=false;};},[client]);
 function changed(){setReview(null);setConfirmed(false);setError('');setNotice('');}
 function remove(slug:string){changed();setMembers(members.filter(m=>m.slug!==slug));setPoints(points.slice(0,-1));}
 async function preview(){if(sending.current||!state)return;sending.current=true;setBusy(true);setError('');setReview(null);setConfirmed(false);try{
  const input=settingsInput(state.season.championship_year,members,points);
  const {data,error}=await client.rpc('league_settings_preview',input);if(error)throw error;
  setReview({input,preview:data});
 }catch(e){setError(e instanceof Error?e.message:(e as {message?:string}).message??'Unable to preview changes.');}finally{sending.current=false;setBusy(false);}}
 async function apply(){if(!review||sending.current)return;sending.current=true;setBusy(true);setError('');try{
  pending.current??=settingsRequest(review.input,review.preview,confirmed,crypto.randomUUID());
  const {data,error}=await client.rpc('league_settings_apply',pending.current);
  if(error){if(['P0001','42501','22023','23514','22P02'].includes(error.code)){pending.current=null;setUncertain(false);setReview(null);setConfirmed(false);throw Error(error.message);}setUncertain(true);throw Error('Result unconfirmed. Retry the same application below; do not submit another change.');}
  if(!data?.applied)throw Error('No application confirmation received. Retry to check safely.');
  pending.current=null;setUncertain(false);receive({...data.settings,version:''});
  setNotice('League database settings applied. Website publication and Fantrax alignment are still required. Download the approved configuration below; no owner accounts were created automatically.');
 }catch(e){if(pending.current)setUncertain(true);setError(e instanceof Error?e.message:'Unable to confirm application. Retry safely.');}finally{sending.current=false;setBusy(false);}}
 function download(){if(!state)return;const content={championship_year:state.season.championship_year,owners:state.owners.filter(o=>o.active).map(({slug,name})=>({slug,name})),placement_points:state.season.placement_points};const url=URL.createObjectURL(new Blob([JSON.stringify(content,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='league-settings.json';link.click();URL.revokeObjectURL(url);}
 if(!state)return <section className={panel}><p role={error?'alert':'status'}>{error||'Loading league settings…'}</p>{denied&&<p className="mt-2 text-slate-600">Your account has no permission to view or change league settings.</p>}<button className={`${secondary} mt-4`} onClick={()=>void client.auth.signOut({scope:'local'})}>Sign out</button></section>;
 return <div className="space-y-5"><section className={panel}><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{state.season.championship_year} Championship · Test league</h2><button className={secondary} disabled={busy||uncertain} onClick={()=>void client.auth.signOut({scope:'local'})}>Sign out</button></div><p className="mt-3 text-slate-600">Propose the owner list and placement points before the draft begins. Preview does not change membership. Existing draft, roster, and trade protections still apply.</p><p className="mt-2 text-sm text-amber-900">Applying changes updates the league database. The public website uses published data files: its configuration and all five Fantrax leagues must be synchronized before release.</p></section>
 {notice&&<section role="status" className={`${panel} text-blue-900`}><p>{notice}</p><button className={`${secondary} mt-3`} onClick={download}>Download approved configuration</button></section>}
 <fieldset disabled={busy||uncertain} className="grid min-w-0 gap-5 lg:grid-cols-2"><section className={panel}><h2 className="text-lg font-bold">Proposed owners ({members.length})</h2><ul className="mt-3 divide-y divide-blue-100">{members.map(m=><li key={m.slug} className="flex items-center justify-between gap-3 py-3"><div><p className="font-semibold">{m.name}</p><p className="text-xs text-slate-500">{m.slug}</p></div><button className={secondary} onClick={()=>remove(m.slug)}>Remove</button></li>)}</ul>
 {state.owners.filter(o=>!members.some(m=>m.slug===o.slug)).map(o=><button key={o.slug} className={`${secondary} mb-2 mr-2`} onClick={()=>{changed();setMembers([...members,{slug:o.slug,name:o.name}]);setPoints([...points,'']);}}>Include {o.name}</button>)}
 <div className="mt-4 grid gap-3 border-t border-blue-100 pt-4"><h3 className="font-semibold">Add a new owner</h3><label>Name<input className={field} value={newName} onChange={e=>setNewName(e.target.value)} maxLength={120}/></label><label>Permanent owner ID<input className={field} value={newSlug} onChange={e=>setNewSlug(e.target.value)} placeholder="e.g. alex"/></label><p className="text-xs text-slate-600">Use lowercase letters, numbers, hyphens or underscores. Start with a letter. Existing identities and historical names cannot be renamed here.</p><button className={secondary} onClick={()=>{if(!newName.trim()||!/^[a-z][a-z0-9_-]*$/.test(newSlug)||state.owners.some(o=>o.slug===newSlug)||members.some(o=>o.slug===newSlug||o.name===newName.trim())){setError('Enter a unique name and permanent ID, or include the existing owner above.');return;}changed();setMembers([...members,{name:newName.trim(),slug:newSlug}]);setPoints([...points,'']);setNewName('');setNewSlug('');}}>Add to proposal</button></div></section>
 <section className={panel}><h2 className="text-lg font-bold">Placement points</h2><p className="mt-2 text-sm text-slate-600">Enter one value per finishing position, decreasing from first to last. The dominance formula stays unchanged. Adding an owner leaves the new value blank for your decision.</p><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{points.map((p,i)=><label key={i} className="text-sm font-semibold">Finish #{i+1}<input className={field} type="number" min="0" step="any" value={p} onChange={e=>{changed();setPoints(points.map((value,n)=>n===i?e.target.value:value));}}/></label>)}</div><p className="mt-5 text-sm text-slate-600">65 startup rounds per owner · 10 rookie picks per owner per year · next two rookie draft years.</p></section></fieldset>
 {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
 <button className={button} disabled={busy||uncertain} onClick={()=>void preview()}>{busy?'Working…':'Preview Changes'}</button>
 {review&&<section className={panel} aria-label="League settings preview"><h2 className="text-xl font-bold">Review proposed changes</h2><p className="mt-3">{review.preview.owner_count} owners · {review.preview.startup_picks} startup picks · {review.preview.rookie_picks_per_year} rookie picks per year</p><p className="mt-2">Add: {review.preview.added.join(', ')||'None'}</p><p>Remove: {review.preview.removed.join(', ')||'None'}</p><p className="mt-2">Placement points: {review.input.points.join(' / ')}</p>
 {review.preview.blockers.length>0?<div role="alert" className="mt-4 rounded-lg bg-amber-50 p-4 text-amber-950"><h3 className="font-bold">Changes cannot be applied yet</h3><ul className="mt-2 list-disc pl-5">{review.preview.blockers.map(b=><li key={b}>{b}</li>)}</ul><p className="mt-2 text-sm">Resolve the blocker, then preview again. Started drafts and trade history will not be erased or rewritten.</p></div>:<><label className="my-4 flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={confirmed} disabled={busy||uncertain} onChange={e=>setConfirmed(e.target.checked)}/><span>I confirm this owner list and placement table. I understand that Fantrax membership and the published website data must also be aligned.</span></label><button className={button} disabled={busy||(!confirmed&&!uncertain)} onClick={()=>void apply()}>{busy?'Applying…':uncertain?'Retry Same Application':'Confirm and Apply Changes'}</button></>}
 </section>}
 </div>;
}
