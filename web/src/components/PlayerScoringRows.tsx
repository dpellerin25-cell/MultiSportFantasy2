"use client";
import {Fragment,useEffect,useId,useState,type ReactNode} from 'react';
import settings from '../../data/league-settings.json';
type Player={player_id:string;player_name:string;known_starter_points:number;counted_points:number;removed_points:number;pending_periods:number;missing_records:number;starter_periods:number};
type Breakdown={available:boolean;players:Player[];pending_periods?:number;last_observed_at?:string|null};
export default function PlayerScoringRows({owner,sport,finish,children}:{owner:string;sport:string;finish:string;children:ReactNode}){
 const [open,setOpen]=useState(false),[year,setYear]=useState(settings.championship_year),[data,setData]=useState<Breakdown|null>(null),[error,setError]=useState('');
 const id=useId();
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();setData(null);setError('');
  const url=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL,key=process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key){setError('Player scoring is not connected yet.');return;}
  void fetch(`${url}/rest/v1/rpc/player_scoring_totals`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({sport_value:sport,cup_year:year,owner_name:owner}),signal:controller.signal,cache:'no-store'})
   .then(async response=>{if(!response.ok)throw Error();const body=await response.json();if(typeof body.available!=='boolean'||!Array.isArray(body.players))throw Error();if(!controller.signal.aborted)setData(body);})
   .catch(()=>{if(!controller.signal.aborted)setError('Player scoring is temporarily unavailable. Close and reopen to retry.');});
  return()=>controller.abort();
 },[open,year,owner,sport]);
 const fmt=(n:number)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:2});
 return <Fragment><tr className="border-b border-blue-50 hover:bg-blue-50/50"><td className="p-4 text-center font-bold">{finish}</td><td className="p-4 font-semibold"><button className="text-left text-blue-800 underline decoration-dotted underline-offset-4" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(!open)}>{owner} <span aria-hidden="true">{open?'▾':'▸'}</span></button></td>{children}</tr>
 {open&&<tr><td colSpan={7} className="bg-blue-50/50 p-4"><section id={id} aria-label={`${owner} player scoring`} className="rounded-lg border border-blue-100 bg-white p-4">
 <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">{owner} · Player contributions</h2><label className="text-sm">Pentagon Cup year <input className="ml-2 w-24 rounded border p-2" type="number" min={2027} max={2200} value={year} onChange={e=>{const n=Number(e.target.value);if(Number.isInteger(n)&&n>=2027&&n<=2200)setYear(n);}}/></label></div>
 <p className="my-3 text-sm text-slate-600">Points belong to the owner whose starting lineup earned them, including players later traded away. Counted points exclude pending periods. These totals do not change the published standings above.</p>
 {error?<p role="alert">{error}</p>:!data?<p role="status">Loading player contributions…</p>:!data.available?<p>No published player scoring for Cup {year} yet.</p>:<>
 <p className="mb-3 text-sm">Pending days/tournaments: {data.pending_periods??0}. Last scoring observation: {data.last_observed_at?new Date(data.last_observed_at).toLocaleString('en-US',{timeZone:'America/New_York'})+' ET':'Not yet collected'}.</p>
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Player</th><th className="p-2 text-right">Known starter points</th><th className="p-2 text-right">Removed</th><th className="p-2 text-right">Counted</th><th className="p-2 text-right">Pending periods</th></tr></thead><tbody>{data.players.map(p=><tr key={p.player_id} className="border-t"><td className="p-2">{p.player_name}{p.missing_records>0&&<span className="block text-xs text-amber-800">Missing scoring records: {p.missing_records}</span>}{p.starter_periods===0&&<span className="block text-xs text-slate-500">Bench only</span>}</td><td className="p-2 text-right">{fmt(p.known_starter_points)}</td><td className="p-2 text-right">{fmt(p.removed_points)}</td><td className="p-2 text-right font-semibold">{fmt(p.counted_points)}</td><td className="p-2 text-right">{p.pending_periods}</td></tr>)}</tbody></table></div>
 {!data.players.length&&<p>No player contributions have been imported yet.</p>}</>}
 </section></td></tr>}</Fragment>;
}
