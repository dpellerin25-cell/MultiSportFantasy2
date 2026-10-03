"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {leagueSettingsClient} from '@/lib/league-settings-client';
export default function LeagueSettingsLink(){
 const [user,setUser]=useState<string|null>(null),[allowed,setAllowed]=useState(false);
 const path=usePathname();
 useEffect(()=>{
  const c=leagueSettingsClient();if(!c)return;
  const {data}=c.auth.onAuthStateChange((_e,s)=>{setAllowed(false);setUser(s?.user.id??null);});
  return()=>data.subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  if(!user)return;let live=true;
  void leagueSettingsClient()!.rpc('league_settings_state').then(({error})=>{if(live)setAllowed(!error);});
  return()=>{live=false;};
 },[user]);
 if(!allowed)return null;
 return <Link href="/league-settings" aria-current={path==='/league-settings'?'page':undefined} className={`inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-semibold sm:px-4 sm:text-base ${path==='/league-settings'?'bg-blue-800 text-white shadow-sm':'text-blue-800 hover:bg-blue-100'}`}>League Settings</Link>;
}
