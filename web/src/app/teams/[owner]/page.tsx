import MainNavigation from "@/components/MainNavigation";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CURRENT_SEASON, getSeason, seasons } from "@/config/seasons";
import SeasonSelector from "@/components/SeasonSelector";
import { getOverallStandings } from "@/lib/overallStandings";
import { getOwnerRosterCounts } from "@/lib/ownerRosters";

const sports = ["NFL", "MLB", "NBA", "EPL", "PGA"] as const;

export default async function TeamPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { owner } = await params;
  const query = await searchParams;
  const requestedYear = Number(query.season);
  const selectedYear =
    Number.isInteger(requestedYear) && getSeason(requestedYear)
      ? requestedYear
      : CURRENT_SEASON;
  const season = getSeason(selectedYear)!;
  const team = getOverallStandings(selectedYear).find(
    (entry) => entry.owner === owner
  );

  if (!team) notFound();

  const rosterCounts = getOwnerRosterCounts(team.owner);
  const totalPlayers = Object.values(rosterCounts).reduce(
    (total, count) => total + count,
    0
  );
  const standingsHref = `/?season=${selectedYear}`;
  const isCurrentSeason = selectedYear === CURRENT_SEASON;

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <MainNavigation standingsHref={standingsHref} />

        <Link href={standingsHref} className="inline-flex min-h-11 items-center font-semibold text-blue-800 hover:underline">
          ← Back to overall standings
        </Link>
        <header className="mb-6 mt-3">
          <p className="text-sm font-semibold text-slate-600">{season.name} · Team detail</p>
          <h1 className="mt-2 break-words text-3xl font-bold sm:text-4xl">{team.owner}</h1>
          <p className="mt-2 text-slate-700">Results across all five sports</p>
          <div className="mt-4">
            <SeasonSelector
              seasons={seasons}
              selectedYear={selectedYear}
              basePath={`/teams/${encodeURIComponent(team.owner)}`}
            />
          </div>
        </header>

        <dl className="mb-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <dt className="text-sm font-semibold text-slate-600">Overall score</dt>
            <dd className="mt-2 text-4xl font-bold text-blue-900">
              {team.total.toFixed(1)} <span className="text-base font-semibold">points</span>
            </dd>
            <dd className="mt-3 text-sm text-slate-600">Upcoming sports contribute zero points.</dd>
          </div>
          <div className="rounded-xl border border-blue-100 bg-white p-5 shadow-sm sm:p-6">
            <dt className="text-sm font-semibold text-slate-600">{isCurrentSeason ? "Current roster count" : "Season roster count"}</dt>
            <dd className={`mt-2 text-4xl font-bold ${totalPlayers >= 65 ? "text-red-800" : "text-blue-900"}`}>
              {isCurrentSeason ? totalPlayers : "—"} {isCurrentSeason && <span className="text-base font-semibold">/ 65 players</span>}
            </dd>
            <dd className="mt-3 text-sm text-slate-600">{isCurrentSeason ? "Across all sports, from the latest roster update." : "Historical roster counts have not been archived."}</dd>
          </div>
        </dl>

        <section aria-labelledby="sport-results">
          <h2 id="sport-results" className="mb-4 text-xl font-bold">Sport results</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sports.map((sport) => {
              const result = team[sport];
              const sportSeason = season.sports.find((entry) => entry.sport === sport)!;
              const hasResult = result.rank !== 0;
              const statusStyle = sportSeason.status === "live"
                ? "bg-green-100 text-green-800"
                : sportSeason.status === "final"
                  ? "bg-slate-100 text-slate-700"
                  : "bg-amber-100 text-amber-800";

              return (
                <article key={sport} aria-labelledby={`result-${sport}`} className="min-w-0 rounded-xl border border-blue-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`result-${sport}`} className="text-lg font-bold">{sport}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${statusStyle}`}>
                      {sportSeason.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{sportSeason.label}</p>
                  <p className="mt-5 text-3xl font-bold text-blue-900">
                    {hasResult ? result.sportScore.toFixed(1) : "—"}
                    {hasResult && <span className="ml-2 text-sm font-semibold">points</span>}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {sportSeason.status === "upcoming" ? "Season has not started" : hasResult ? "Sport score" : "No result available"}
                  </p>
                  <dl className="mt-5 space-y-3 border-t border-blue-100 pt-4 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">Rank</dt><dd className="font-semibold">{hasResult ? `#${result.rank}` : "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">Fantasy points</dt><dd className="font-semibold">{hasResult ? result.fantasyPoints.toFixed(1) : "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">Placement points</dt><dd className="font-semibold">{hasResult ? result.placementPoints.toFixed(0) : "—"}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-slate-600">Dominance bonus</dt><dd className="font-semibold">{hasResult ? `${result.dominanceScore >= 0 ? "+" : ""}${result.dominanceScore.toFixed(1)}` : "—"}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-blue-100 pt-3"><dt className="text-slate-600">{isCurrentSeason ? "Current roster" : "Season roster"}</dt><dd className="font-semibold">{isCurrentSeason ? `${rosterCounts[sport]} ${rosterCounts[sport] === 1 ? "player" : "players"}` : "Not archived"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
