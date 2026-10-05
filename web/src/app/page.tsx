import MainNavigation from "@/components/MainNavigation";
import Link from "next/link";

import { getOverallStandings, type SportResult } from "@/lib/overallStandings";
import { CURRENT_SEASON, getSeason, seasons } from "@/config/seasons";
import SeasonSelector from "@/components/SeasonSelector";
import { getSeasonLeagueData } from "@/lib/seasonData";

type HomeProps = {
  searchParams: Promise<{
    season?: string;
  }>;
};

function ordinal(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";

  return `${rank}th`;
}

function SportCell({
  result,
}: {
  result: SportResult;
}) {
  const dominance =
    result.dominanceScore >= 0
      ? `+${result.dominanceScore.toFixed(1)}`
      : result.dominanceScore.toFixed(1);

  const zScore =
    result.zScore >= 0
      ? `+${result.zScore.toFixed(2)}`
      : result.zScore.toFixed(2);

  return (
    <td className="p-3 text-center">
      <div className="group relative inline-block">
        <button
          type="button"
          className="min-w-20 rounded-lg px-3 py-2 font-bold text-slate-900 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
        >
          <span className="block">
            {result.rank === 0 ? "—" : result.sportScore.toFixed(1)}
          </span>
          {result.rank > 0 && (
            <span className="mt-1 block text-xs font-normal text-slate-500">
              {ordinal(result.rank)}
            </span>
          )}
        </button>

        <div
          className="
            pointer-events-none
            absolute
            left-1/2
            top-full
            z-50
            mt-2
            hidden
            w-64
            -translate-x-1/2
            rounded-xl
            border
            border-blue-100
            bg-white
            p-4
            text-left
            shadow-xl
            group-hover:block
            group-focus-within:block
          "
        >
          <div className="mb-3 border-b border-blue-100 pb-2">
            <div className="text-lg font-bold text-slate-900">
              {result.sportScore.toFixed(1)} points
            </div>

            <div className="text-sm text-slate-600">
              Total sport points
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-700">
            <div className="flex justify-between">
              <span>Finish</span>
              <span className="font-semibold text-slate-900">
                {ordinal(result.rank)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Placement points</span>
              <span className="font-semibold text-slate-900">
                {result.placementPoints.toFixed(0)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Fantasy points</span>
              <span className="font-semibold text-slate-900">
                {result.fantasyPoints.toFixed(1)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>League average</span>
              <span className="font-semibold text-slate-900">
                {result.leagueAverage.toFixed(1)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Z-score</span>
              <span className="font-semibold text-slate-900">
                {zScore}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Dominance</span>
              <span className="font-semibold text-slate-900">
                {dominance}
              </span>
            </div>
          </div>

          <div className="mt-3 border-t border-blue-100 pt-3">
            <div className="flex justify-between font-bold text-slate-900">
              <span>Total points</span>
              <span>{result.sportScore.toFixed(1)}</span>
            </div>
            <p className="mt-2 text-xs font-semibold text-blue-800">Total Points = Placement Points + Dominance</p>
            {result.rank > 0 && <p className="mt-1 text-xs text-slate-600">{result.placementPoints.toFixed(0)} {dominance} = {result.sportScore.toFixed(1)}</p>}
          </div>
        </div>
      </div>
    </td>
  );
}

export default async function Home({
  searchParams,
}: HomeProps) {
  const params = await searchParams;

  const requestedYear = Number(params.season);

  const selectedYear =
    Number.isInteger(requestedYear) &&
    getSeason(requestedYear)
      ? requestedYear
      : CURRENT_SEASON;

  const currentSeason = getSeason(selectedYear);
  const standings = getOverallStandings(selectedYear);
  const updateTimes = (currentSeason?.sports ?? [])
    .filter(sport => sport.status !== "upcoming")
    .map(sport => Date.parse(getSeasonLeagueData(selectedYear, sport.sport).updated_at ?? ""))
    .filter(Number.isFinite);
  const lastUpdated = updateTimes.length ? new Date(Math.max(...updateTimes)) : null;

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 sm:p-8">
      <div className="mx-auto max-w-7xl">

        <MainNavigation />

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            Pentagon Cup
          </h1>

          <p className="mt-2 text-sm text-slate-700 sm:text-base">
            Overall standings across all five sports
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Standings last updated: {lastUpdated ? <time dateTime={lastUpdated.toISOString()}>{lastUpdated.toLocaleString("en-US", {timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short"})} Eastern</time> : "Not yet available"}.
            {selectedYear === CURRENT_SEASON && " Scheduled updates: Tuesdays at 4 a.m. Eastern. Rosters update daily."}
          </p>

          {currentSeason && (
            <>
              <div className="mt-4">
                <SeasonSelector
                  seasons={seasons}
                  selectedYear={selectedYear}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {currentSeason.sports.map((sport) => (
                  <div
                    key={sport.sport}
                    className="flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 shadow-sm"
                  >
                    <span className="text-xs font-bold text-slate-900 sm:text-sm">
                      {sport.label}
                    </span>

                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        sport.status === "final"
                          ? "bg-slate-100 text-slate-700"
                          : sport.status === "live"
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {sport.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mb-6">
          <Link
            href="/scoring"
            className="font-bold text-blue-700 hover:text-blue-900 hover:underline"
          >
            View League Constitution
          </Link>
        </div>


        <div className="overflow-x-auto rounded-xl border border-blue-100 bg-white shadow-sm">
          <table className="w-full min-w-[850px] border-collapse">
            <thead>
              <tr className="border-b border-blue-100 bg-blue-50">
                <th className="p-4 text-center font-bold text-slate-900">
                  Overall
                </th>

                <th className="p-4 text-left font-bold text-slate-900">
                  Owner
                </th>

                <th className="p-4 text-center font-bold text-slate-900">
                  NFL
                </th>

                <th className="p-4 text-center font-bold text-slate-900">
                  MLB
                </th>

                <th className="p-4 text-center font-bold text-slate-900">
                  NBA
                </th>

                <th className="p-4 text-center font-bold text-slate-900">
                  EPL
                </th>

                <th className="p-4 text-center font-bold text-slate-900">
                  PGA
                </th>

                <th className="border-l-2 border-blue-300 bg-blue-800 p-4 text-center font-extrabold text-white">
                  Total
                </th>
              </tr>
            </thead>

            <tbody>
              {standings.map(
                (team, index) => (
                  <tr
                    key={team.owner}
                    className="border-b border-blue-100 last:border-b-0 hover:bg-blue-50/50"
                  >
                    <td className="p-4 text-center text-lg font-bold text-slate-900">
                      {index + 1}
                    </td>

                    <td className="p-4 font-semibold text-slate-900">
                      <Link
                        href={`/teams/${encodeURIComponent(team.owner)}?season=${selectedYear}`}
                        className="inline-flex min-h-11 items-center rounded text-blue-800 underline decoration-blue-200 underline-offset-4 transition hover:text-blue-600 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700"
                      >
                        {team.owner}
                      </Link>
                    </td>

                    <SportCell result={team.NFL} />
                    <SportCell result={team.MLB} />
                    <SportCell result={team.NBA} />
                    <SportCell result={team.EPL} />
                    <SportCell result={team.PGA} />

                    <td className="border-l-2 border-blue-200 bg-blue-100 p-4 text-center text-lg font-extrabold tabular-nums text-blue-950">
                      {team.total.toFixed(1)}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
