"use client";

import {useEffect, useRef, useState, type FormEvent} from "react";
import type {Session} from "@supabase/supabase-js";
import {leagueSettingsClient} from "@/lib/league-settings-client";
import type {TradeRoster} from "@/lib/trade-model";

const button = "min-h-11 rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-900 disabled:opacity-50";

export default function SiteAccount() {
  const [session, setSession] = useState<Session|null>(null);
  const [ready, setReady] = useState(false);
  const [owner, setOwner] = useState<{userId:string;name:string}|null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const client = leagueSettingsClient();
    if (!client) return;
    const {data} = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
      if (next) setOpen(false);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    // Resolve the linked league identity outside the auth callback.
    void Promise.resolve(leagueSettingsClient()!.rpc("trade_rosters")).then(({data, error}) => {
      if (!active || error || !data) return;
      const roster = data as TradeRoster;
      const linked = roster.owners.find(o => o.id === roster.viewer_owner_id);
      if (linked) setOwner({userId, name:linked.name});
    }).catch(() => { /* Keep the signed-in account usable if identity lookup fails. */ });
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  async function signIn(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const client = leagueSettingsClient();
    if (!client || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);setError("");
    try {
      const {error} = await client.auth.signInWithPassword({email:String(form.get("email")).trim(), password:String(form.get("password"))});
      if (error) setError("Sign-in failed. Check your email and password.");
      else setOpen(false);
    } catch { setError("Unable to connect. Please try again."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);setError("");
    try {
      const result = await leagueSettingsClient()!.auth.signOut({scope:"local"});
      if (result.error) setError("Unable to sign out. Please try again.");
    } catch { setError("Unable to connect. Please try again."); }
    finally { setBusy(false); }
  }

  return <header aria-label="Your account" className="border-b border-blue-100 bg-blue-50 px-4 py-3 text-slate-900 sm:px-8">
    <div className="flex flex-wrap items-center justify-end gap-3">
      {session ? <>
        <span className="text-sm font-semibold" role="status">{owner && owner.userId === userId ? `Signed in as ${owner.name}` : "Signed in · Owner name unavailable"}</span>
        <a className={button} href="https://discord.gg/aJFKbDKhG" target="_blank" rel="noopener noreferrer">Check the Discord<span className="sr-only"> (opens in a new tab)</span></a>
        <button className="min-h-11 rounded-lg px-3 text-sm font-semibold text-blue-800 hover:bg-blue-100 disabled:opacity-50" disabled={busy} onClick={() => void signOut()}>Sign out</button>
      </> : <button ref={trigger} className={button} onClick={() => {setError("");setOpen(true);}}>Sign in</button>}
    </div>
    {!open && error && <p role="alert" className="mt-2 text-right text-sm text-red-800">{error}</p>}
    <dialog ref={dialog} aria-labelledby="site-sign-in-title" onCancel={event => {event.preventDefault();if(!busy)setOpen(false);}} onClose={() => trigger.current?.focus()} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-blue-100 bg-white p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/50">
      <h2 id="site-sign-in-title" className="text-xl font-bold">Owner sign in</h2>
      <p className="mt-2 text-sm text-slate-600">Use your league account for trades, the draft, and the rest of the website.</p>
      {open && <form onSubmit={signIn} className="mt-5 grid gap-4">
        <label className="text-sm font-semibold">Email<input autoFocus name="email" type="email" autoComplete="username" required className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
        <label className="text-sm font-semibold">Password<input name="password" type="password" autoComplete="current-password" required className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
        {!ready && <p role="status" className="text-sm text-slate-600">{leagueSettingsClient() ? "Checking sign-in…" : "Sign-in is not configured for this website yet."}</p>}
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <div className="flex justify-end gap-3"><button type="button" disabled={busy} className="min-h-11 rounded-lg px-4 text-sm font-semibold hover:bg-slate-100" onClick={() => setOpen(false)}>Cancel</button><button className={button} disabled={busy || !ready}>{busy ? "Signing in…" : "Sign in"}</button></div>
      </form>}
    </dialog>
  </header>;
}

