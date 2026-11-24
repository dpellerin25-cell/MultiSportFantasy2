"use client";

import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {leagueSettingsClient,leagueSettingsConfigured} from '@/lib/league-settings-client';
import {validateNewPassword} from '@/lib/account-setup';

export default function ChangePassword(){
  const [userId,setUserId]=useState<string|null>(null);
  const [ready,setReady]=useState(!leagueSettingsConfigured);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{
    const client=leagueSettingsClient();
    if(!client)return;
    const {data}=client.auth.onAuthStateChange((_event,session)=>{
      setUserId(session?.user.id??null);setReady(true);
    });
    return ()=>data.subscription.unsubscribe();
  },[]);

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy||!userId)return;
    const form=event.currentTarget,values=new FormData(form);
    setError('');setSaved(false);
    try{validateNewPassword(String(values.get('password')),String(values.get('confirm')));}
    catch(e){setError((e as Error).message);return;}
    setBusy(true);
    try{
      const client=leagueSettingsClient();
      if(!client)throw Error();
      const identity=await client.auth.getUser();
      if(identity.error||identity.data.user?.id!==userId){
        setError('Your session changed or expired. Sign in again before changing your password.');return;
      }
      const result=await client.auth.updateUser({password:String(values.get('password'))});
      if(result.error){
        setError(result.error.code==='same_password'
          ?'Choose a password different from your current password.'
          :'Your password could not be changed. Sign in again and retry, or use the password reset link below.');
        return;
      }
      form.reset();setSaved(true);
    }catch{setError('Unable to connect. Please try again.');}
    finally{setBusy(false);}
  }

  return <section>
    <h1 className="text-2xl font-bold">Change your password</h1>
    {!ready?<p className="mt-4" role="status">Checking sign-in…</p>:!userId?<p className="mt-4">Use the Sign in button above to change your password.</p>:<form key={userId} onSubmit={submit} className="mt-5 grid gap-4">
      <p>Use at least 6 characters for your new password.</p>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={6} required disabled={busy} className="mt-1 block min-h-11 w-full rounded border p-3"/></label>
      <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={6} required disabled={busy} className="mt-1 block min-h-11 w-full rounded border p-3"/></label>
      {error&&<p role="alert" className="text-red-800">{error}</p>}
      {saved&&<p role="status" className="text-green-800">Your password has been changed.</p>}
      <button disabled={busy} className="min-h-11 rounded-lg bg-blue-800 p-3 font-semibold text-white disabled:opacity-50">{busy?'Saving…':'Save new password'}</button>
    </form>}
    <Link href="/auth/reset" className="mt-5 block text-blue-800 underline">Forgot your password? Request a reset link</Link>
  </section>;
}
