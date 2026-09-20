"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { DRAFT_OWNERS, type DraftTrade, type RookiePick } from "@/lib/rookieDraft";

export type DraftSnapshot = {
  years: number[];
  picks: RookiePick[];
  trades: DraftTrade[];
  editingAvailable: boolean;
};

type DraftContextValue = DraftSnapshot & {
  unlocked: boolean;
  busy: boolean;
  transfer: (pick: RookiePick, to: string) => Promise<boolean>;
};

const DraftContext = createContext<DraftContextValue | null>(null);

export function RookieDraftProvider({ initial, children }: { initial: DraftSnapshot; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [password, setPassword] = useState("");
  const [credential, setCredential] = useState("");
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load(access?: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/rookie-draft", {
        cache: "no-store",
        headers: access ? { Authorization: `Bearer ${access}` } : {},
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      if (access) {
        setCredential(access);
        setPassword("");
        setShowLogin(false);
      }
      setMessage(access ? "Commissioner editing unlocked. Expand an owner to transfer a pick." : "Picks refreshed.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load draft picks.");
    } finally {
      setBusy(false);
    }
  }

  async function transfer(pick: RookiePick, to: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/rookie-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
        body: JSON.stringify({ year: pick.year, round: pick.round, originalOwner: pick.originalOwner, from: pick.owner, to }),
      });
      const data = await response.json();
      if (response.status === 401) setCredential("");
      if (!response.ok) throw new Error(data.error);
      setSnapshot(data);
      setMessage(`Saved: ${pick.year} round ${pick.round} (${pick.originalOwner}'s pick) transferred from ${pick.owner} to ${to}.`);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the trade. Refresh picks before retrying.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <DraftContext.Provider value={{ ...snapshot, unlocked: Boolean(credential), busy, transfer }}>
      <section aria-labelledby="rookie-draft-heading" className="mb-6 rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="rookie-draft-heading" className="text-lg font-bold text-slate-900">Rookie draft picks · {snapshot.years.join(" & ")}</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">10 rounds each year. Each owner starts with one pick per round. Traded picks keep their original owner’s name.</p>
            <p className="mt-1 text-sm text-slate-600">Expand an owner to see their picks. Picks do not count toward the 65-player cap.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => load()} className="min-h-11 rounded-lg border border-blue-200 px-3 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50">Refresh picks</button>
            {snapshot.editingAvailable && (credential ? (
              <button type="button" disabled={busy} onClick={() => { setCredential(""); setMessage("Commissioner editing locked."); }} className="min-h-11 rounded-lg bg-blue-800 px-3 text-sm font-semibold text-white disabled:opacity-50">Lock editing</button>
            ) : (
              <button type="button" aria-expanded={showLogin} onClick={() => setShowLogin(!showLogin)} className="min-h-11 rounded-lg bg-blue-800 px-3 text-sm font-semibold text-white hover:bg-blue-900">Commissioner controls</button>
            ))}
          </div>
        </div>
        {showLogin && !credential && (
          <form className="mt-4 flex max-w-lg flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void load(password); }}>
            <label className="min-w-0 flex-1 text-sm font-semibold text-slate-700">
              Commissioner password
              <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-slate-900" />
            </label>
            <button disabled={busy} className="min-h-11 rounded-lg bg-blue-800 px-4 font-semibold text-white disabled:opacity-50">Unlock editing</button>
          </form>
        )}
        <p role="status" className="mt-3 text-sm font-medium text-blue-800">{busy ? "Saving or loading picks…" : message}</p>
        {error && <p role="alert" className="mt-2 text-sm font-semibold text-red-800">{error}</p>}
        {snapshot.trades.length > 0 && (
          <details className="mt-3 border-t border-blue-100 pt-3">
            <summary className="cursor-pointer py-2 text-sm font-semibold text-blue-800">Trade history ({snapshot.trades.length})</summary>
            <ul className="mt-2 max-h-64 space-y-3 overflow-y-auto text-sm text-slate-700">
              {[...snapshot.trades].reverse().map((trade) => (
                <li key={trade.id}>
                  <span className="font-semibold">{trade.year} · Round {trade.round} · {trade.originalOwner}’s pick</span>
                  <br />{trade.from} → {trade.to} · <time dateTime={trade.tradedAt}>{trade.tradedAt.slice(0, 10)} (UTC)</time>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      {children}
    </DraftContext.Provider>
  );
}

export function OwnerRookiePicks({ owner }: { owner: string }) {
  const draft = useContext(DraftContext);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("");
  const [saveError, setSaveError] = useState(false);
  if (!draft) return null;
  const owned = draft.picks.filter((pick) => pick.owner === owner);

  return (
    <section className="border-b border-blue-100 p-4 sm:p-5" aria-label={`${owner}'s rookie draft picks`}>
      <h3 className="font-bold text-slate-900">Rookie draft picks</h3>
      <div className="mt-3 space-y-5">
        {draft.years.map((year) => {
          const picks = owned.filter((pick) => pick.year === year);
          return (
            <div key={year}>
              <h4 className="mb-2 flex items-center justify-between text-sm font-bold text-slate-800">
                {year}<span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-800">{picks.length} {picks.length === 1 ? "pick" : "picks"}</span>
              </h4>
              {picks.length === 0 ? <p className="text-sm text-slate-600">No picks owned for {year}.</p> : (
                <ul className="divide-y divide-blue-50">
                  {picks.map((pick) => (
                    <li key={pick.id} className="py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 text-sm">
                          <span className="font-semibold text-slate-900">Round {pick.round}</span>
                          <span className="ml-2 text-slate-600">{pick.originalOwner}’s pick</span>
                          {pick.originalOwner !== owner && <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-800">Acquired</span>}
                        </div>
                        {draft.unlocked && <button type="button" disabled={draft.busy} onClick={() => { setEditingId(pick.id); setRecipient(""); setSaveError(false); }} aria-label={`Transfer ${year} round ${pick.round}, originally ${pick.originalOwner}`} className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:opacity-50">Transfer</button>}
                      </div>
                      {draft.unlocked && editingId === pick.id && (
                        <form className="mt-2 rounded-lg bg-blue-50 p-3" onSubmit={async (event) => { event.preventDefault(); setSaveError(false); if (await draft.transfer(pick, recipient)) setEditingId(null); else setSaveError(true); }}>
                          <label className="block text-sm font-semibold text-slate-700">
                            Transfer to
                            <select required disabled={draft.busy} value={recipient} onChange={(event) => setRecipient(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-blue-200 bg-white px-2 text-slate-900">
                              <option value="">Choose owner</option>
                              {DRAFT_OWNERS.filter((name) => name !== owner).map((name) => <option key={name} value={name}>{name}</option>)}
                            </select>
                          </label>
                          <p className="mt-2 text-xs text-slate-600">{year} round {pick.round}, originally {pick.originalOwner}. Moves from {owner} to {recipient || "the selected owner"}.</p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button disabled={draft.busy || !recipient} className="min-h-11 rounded-lg bg-blue-800 px-3 text-sm font-semibold text-white disabled:opacity-50">Save transfer</button>
                            <button type="button" disabled={draft.busy} onClick={() => setEditingId(null)} className="min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-blue-800">Cancel</button>
                          </div>
                          {saveError && <p role="alert" className="mt-2 text-sm font-semibold text-red-800">Transfer not confirmed. See the message above and refresh picks before retrying.</p>}
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
