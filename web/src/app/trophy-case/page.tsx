import MainNavigation from "@/components/MainNavigation";
import Link from "next/link";
import { connection } from "next/server";
import { getTrophyCase } from "@/lib/trophyData";
import { TROPHY_CATEGORIES, TROPHY_LABELS } from "@/lib/trophies";

export const metadata = { title: "Trophy Case | Multi-Sport Fantasy League" };

function Trophy({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3h8v6a4 4 0 0 1-8 0V3Z" />
      <path d="M8 5H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v5m-4 3h8m-6-3h4l2 3H8l2-3Z" />
    </svg>
  );
}

export default async function TrophyCasePage() {
  await connection();
  const { owners, history, totalTrophies } = getTrophyCase();
  const overallChampionships = owners.reduce((sum, owner) => sum + owner.counts.Overall, 0);

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <MainNavigation />

        <header className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-800"><Trophy /> League honors</div>
          <h1 className="text-3xl font-bold sm:text-4xl">Trophy Case</h1>
          <p className="mt-2 max-w-2xl text-slate-600">Five sports. One All-Sport Champion. A home for every championship earned by our owners.</p>
        </header>

        <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ["Trophies awarded", totalTrophies],
            ["All-Sport Championships", overallChampionships],
            ["League owners", owners.length],
          ].map(([label, count]) => (
            <div key={label} className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
              <dt className="text-sm font-semibold text-slate-600">{label}</dt>
              <dd className="mt-2 text-3xl font-bold text-blue-900">{count}</dd>
            </div>
          ))}
        </dl>

        {totalTrophies === 0 && (
          <section className="mb-10 rounded-2xl border border-blue-200 bg-white px-5 py-10 text-center shadow-sm sm:py-12">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-700"><Trophy className="h-9 w-9" /></div>
            <h2 className="text-xl font-bold sm:text-2xl">No championships have been awarded yet.</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">The first trophies will appear here when final results are archived and confirmed. Live standings do not count as championships.</p>
            <Link href="/" className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-800 px-4 text-sm font-semibold text-white hover:bg-blue-900">View current standings</Link>
          </section>
        )}

        <section aria-labelledby="owner-trophies" className="mb-10">
          <h2 id="owner-trophies" className="text-xl font-bold">Championships by owner</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">Career titles across all archived championship years. Each title counts as one trophy.</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {owners.map(({ owner, counts, total }) => (
              <article key={owner} className="min-w-0 rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="break-words text-lg font-bold">{owner}</h3>
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-800"><Trophy className="h-4 w-4" />{total} <span className="sr-only">total trophies</span></span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-blue-100 pt-4">
                  {TROPHY_CATEGORIES.map((category) => (
                    <div key={category}>
                      <dt className="text-xs font-medium text-slate-600">{TROPHY_LABELS[category]}</dt>
                      <dd className={`mt-0.5 text-lg font-bold ${counts[category] ? "text-blue-900" : "text-slate-500"}`}>{counts[category]}</dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="championship-history" className="mb-8">
          <h2 id="championship-history" className="text-xl font-bold">Championship history</h2>
          <p className="mb-4 mt-1 text-sm text-slate-600">Season by season, newest first. Sport titles can be awarded before the overall championship is complete.</p>
          {history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-blue-200 bg-white p-6 text-sm text-slate-600">Completed sports and championship seasons will appear here as their results are finalized.</div>
          ) : (
            <div className="space-y-5">
              {history.map((season) => (
                <article key={season.year} className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
                  <h3 className="mb-4 text-lg font-bold">{season.name}</h3>
                  <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {season.championships.map((championship) => (
                      <div key={championship.category} className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600">{championship.category === "Overall" ? "All-Sport Champion" : `${TROPHY_LABELS[championship.category]} Champion`}</dt>
                        <dd className="mt-2">
                          {championship.status === "awarded" ? (
                            <>
                              <span className="flex items-center gap-2 font-bold text-blue-900"><Trophy className="h-5 w-5 shrink-0" />{championship.owner}</span>
                              {championship.score !== undefined && <span className="mt-1 block text-sm text-slate-600">{championship.score.toFixed(1)} overall points</span>}
                            </>
                          ) : <span className={`text-sm ${championship.status === "pending" ? "text-slate-600" : "font-medium text-amber-900"}`}>{championship.note}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="rounded-xl bg-blue-100/50 p-5 text-sm leading-6 text-slate-700">
          <h2 className="font-bold text-slate-900">How trophies are awarded</h2>
          <p className="mt-1">A sport champion must be the sole first-place owner in its confirmed final archive. The All-Sport Champion has the highest combined score across all five final sports, using the league’s existing scoring system. Unresolved ties and incomplete archives are left unawarded.</p>
          <Link href="/scoring" className="mt-2 inline-block font-semibold text-blue-800 hover:underline">View the scoring system →</Link>
        </aside>
      </div>
    </main>
  );
}
