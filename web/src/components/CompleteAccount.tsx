"use client";
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {leagueSettingsClient} from '@/lib/league-settings-client';
import {parseEmailLink,validateNewPassword,type EmailLink} from '@/lib/account-setup';
export default function CompleteAccount(){
 const verifiedUser=useRef<string|null>(null),invitation=useRef<string|null>(null);
 const link=useRef<EmailLink|null>(null),captured=useRef(false),[ready,setReady]=useState(false),[verified,setVerified]=useState(false),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 useEffect(()=>{if(captured.current)return;captured.current=true;try{link.current=parseEmailLink(window.location.href);setReady(true);}catch(e){setError((e as Error).message);}finally{window.history.replaceState(null,'','/auth/complete');}},[]);
 async function verify(){if(!link.current||busy)return;setBusy(true);setError('');try{const c=leagueSettingsClient();if(!c)throw Error();const l=link.current;
  const result='token_hash' in l?await c.auth.verifyOtp({token_hash:l.token_hash,type:l.type}):await c.auth.setSession({access_token:l.access_token,refresh_token:l.refresh_token});
  if(result.error)throw Error();const identity=await c.auth.getUser();if(identity.error||!identity.data.user)throw Error();verifiedUser.current=identity.data.user.id;setVerified(true);
 }catch{setError('This link could not be verified. It may have expired or already been used. Request a new email.');}finally{setBusy(false);}}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;const form=new FormData(e.currentTarget);setBusy(true);setError('');try{const c=leagueSettingsClient()!;
  const current=await c.auth.getUser();if(current.error||current.data.user?.id!==verifiedUser.current)throw Error('The signed-in account changed. Reopen the email link or request a new one.');
  if(!saved){const password=String(form.get('password'));validateNewPassword(password,String(form.get('confirm')));const result=await c.auth.updateUser({password});if(result.error)throw Error('Password could not be saved. Use a strong password that meets the configured account policy.');setSaved(true);}
  if(link.current?.type==='invite'){if(!invitation.current){const {data,error}=await c.rpc('my_owner_invitation');if(error||!data)throw Error('Password saved, but no valid owner invitation was found. Contact Doug; your team has not been changed.');invitation.current=data.id;}const accepted=await c.rpc('accept_owner_invitation',{invitation:invitation.current});if(accepted.error)throw Error('Password saved. Owner linking could not be confirmed. Sign in and open Create an Account, or contact Doug.');}
  setDone(true);
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section><h1 className="text-2xl font-bold">{link.current?.type==='invite'?'Finish creating your account':'Choose a new password'}</h1>{error&&<p role="alert" className="my-4 text-red-800">{error}</p>}{done?<><p className="my-4">Your password has been saved{link.current?.type==='invite'?' and your owner account is connected':''}.</p><a href="/" className="text-blue-800 underline">Continue to the website</a></>:!verified?<><p className="my-4">Continue to verify your email link.</p><button disabled={!ready||busy} onClick={()=>void verify()} className="rounded-lg bg-blue-800 p-3 text-white disabled:opacity-50">Continue securely</button></>:<form onSubmit={submit} className="my-4 grid gap-4">{!saved&&<><label>New password<input className="mt-1 block w-full rounded border p-3" name="password" type="password" autoComplete="new-password" minLength={12} required/></label><label>Confirm password<input className="mt-1 block w-full rounded border p-3" name="confirm" type="password" autoComplete="new-password" minLength={12} required/></label><p className="text-sm">Use at least 12 characters. A password manager can help.</p></>}<button disabled={busy} className="rounded-lg bg-blue-800 p-3 text-white disabled:opacity-50">{busy?'Saving…':saved?'Retry owner connection':'Save password'}</button></form>}<Link className="mt-5 block text-blue-800 underline" href="/auth/reset">Request a new password reset link</Link></section>;
}

