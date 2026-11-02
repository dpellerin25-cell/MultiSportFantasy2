"use client";
import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {leagueSettingsClient} from '@/lib/league-settings-client';
import {authReturnUrl,resetNotice} from '@/lib/account-setup';
const input='mt-1 block w-full rounded-lg border p-3';
export function PasswordReset(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy)return;setBusy(true);setMessage('');const email=String(new FormData(e.currentTarget).get('email')).trim();
  try{const client=leagueSettingsClient();if(!client)throw Error('Account emails are not configured. Contact Doug.');const redirectTo=authReturnUrl(process.env.NEXT_PUBLIC_AUTH_SITE_URL);await client.auth.resetPasswordForEmail(email,{redirectTo});setMessage(resetNotice);}
  catch{setMessage('If your request could not be processed, try again later or contact Doug. Check your inbox and spam folder for any reset email.');}finally{setBusy(false);}}
 return <section><h1 className="text-2xl font-bold">Reset your password</h1><p className="my-3">Enter your account email. Check your inbox and spam folder for the reset link.</p><form onSubmit={submit} className="space-y-4"><label>Email<input className={input} name="email" type="email" autoComplete="email" required/></label><button disabled={busy} className="rounded-lg bg-blue-800 p-3 text-white disabled:opacity-50">{busy?'Requesting…':'Send password reset link'}</button></form>{message&&<p role="status" className="mt-4">{message}</p>}</section>;
}
export function CreateAccount(){
 const [invite,setInvite]=useState<{id:string;owner:string}|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const c=leagueSettingsClient();if(!c)return;let live=true,generation=0;const {data}=c.auth.onAuthStateChange(()=>{const current=++generation;setInvite(null);setTimeout(()=>{void c.rpc('my_owner_invitation').then(({data,error})=>{if(live&&current===generation)setInvite(error?null:data);});},0);});return()=>{live=false;data.subscription.unsubscribe();};},[]);
 async function accept(){if(!invite||busy)return;setBusy(true);const {error}=await leagueSettingsClient()!.rpc('accept_owner_invitation',{invitation:invite.id});setBusy(false);if(error)setMessage('Unable to link this account. The invitation may have expired, been revoked, or already been claimed. Contact Doug.');else window.location.assign('/');}
 return <section><h1 className="text-2xl font-bold">Create an Account</h1><p className="my-4">Ask Doug for an invitation for your league owner identity. Open the email invitation to verify your email and create a password. Check your spam folder too.</p><p className="mb-4">If you already have an account, sign in using the top-right button. Your approved owner invitation will appear here.</p>{invite&&<div className="rounded-lg bg-blue-50 p-4"><p>Doug has invited this verified email to join as <strong>{invite.owner}</strong>.</p><button className="mt-3 rounded-lg bg-blue-800 p-3 text-white" disabled={busy} onClick={()=>void accept()}>Accept invitation as {invite.owner}</button></div>}{message&&<p role="alert">{message}</p>}<Link href="/auth/reset" className="mt-5 inline-block text-blue-800 underline">I&apos;m an idiot and forgot my password</Link></section>;
}
