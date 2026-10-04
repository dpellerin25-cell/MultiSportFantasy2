"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicPicks } from "@/lib/public-picks";
const Context = createContext<PublicPicks | null>(null);

export function RookieDraftProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<PublicPicks | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true, version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const response = await fetch("/api/rookie-draft", { cache: "no-store", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error("Unavailable");
        const data: PublicPicks = await response.json();
        if (!active || request !== version) return;
        setSnapshot(data); setError("");
      } catch {
        if (!active || request !== version) return;
        // Do not present stale ownership as current or fall back to local files.
        setSnapshot(null); setError("Pick ownership could not be refreshed. Please try again.");
      }
    };
    const visibleLoad = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    const timer = setInterval(visibleLoad, 30000);
    window.addEventListener("focus", visibleLoad);
    window.addEventListener("rookie-picks-changed", visibleLoad);
    document.addEventListener("visibilitychange", visibleLoad);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", visibleLoad); window.removeEventListener("rookie-picks-changed", visibleLoad); document.removeEventListener("visibilitychange", visibleLoad); };
  }, [refresh]);
  const ready = snapshot?.ledger_ready;
  return <Context.Provider value={ready ? snapshot : null}>
    <section className="mb-6 rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold">Rookie draft picks{snapshot ? ` · ${snapshot.years.join(" & ")}` : ""}</h2>
          <p className="mt-1 text-sm text-slate-600">Current ownership from the league database. Accepted trades update pick ownership immediately.</p></div>
        <button className="min-h-11 rounded-lg border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50" onClick={() => setRefresh(n => n + 1)}>Refresh picks</button>
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : !snapshot ? <p role="status" className="mt-3 text-sm">Loading pick ownership…</p> : !ready ? <p role="status" className="mt-3 text-sm text-amber-900">Pick ownership has not been fully initialized in the league database. Contact Doug.</p> : null}
    </section>
    {children}
  </Context.Provider>;
}
export function OwnerRookiePicks({ owner }: { owner: string }) {
  const snapshot = useContext(Context);
  const id = snapshot?.owners.find(o => o.name === owner)?.id;
  return <section className="border-b border-blue-100 p-4 sm:p-5" aria-label={`${owner}'s rookie draft picks`}>
    <h3 className="font-bold">Rookie draft picks</h3>
    {!snapshot || !id ? <p className="mt-2 text-sm text-slate-600">Current pick ownership unavailable.</p> : snapshot.years.map(year => {
      const picks = snapshot.picks.filter(p => p.owner_id === id && p.year === year);
      return <div key={year} className="mt-4"><h4 className="font-semibold text-blue-900">{year}</h4>
        <ul className="divide-y divide-blue-50">{picks.map(p => <li key={p.id} className="py-2 text-sm">Round {p.round} · {snapshot.owners.find(o => o.id === p.original_owner_id)?.name ?? "Original owner"}’s pick{p.original_owner_id !== id && <span className="text-blue-800"> · Acquired</span>}</li>)}</ul>
        {!picks.length && <p className="mt-2 text-sm text-slate-600">No picks owned for {year}.</p>}
      </div>;
    })}
  </section>;
}
