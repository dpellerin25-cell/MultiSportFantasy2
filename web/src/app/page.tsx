import Link from "next/link";

import { getSeasonLeagueData } from "@/lib/seasonData";

import {
  scoreLeague,
  ScoredTeam,
} from "@/lib/scoring";

import {
  CURRENT_SEASON,
  getSeason,
  seasons,
} from "@/config/seasons";

import SeasonSelector from "@/components/SeasonSelector";

type SportResult = {
  rank: number;
  fantasyPoints: number;
  leagueAverage: number;
  standardDeviation: number;
  zScore: number;
  placementPoints: number;
  dominanceScore: number;
  sportScore: number;
};

type OverallRow = {
  owner: string;
  NFL: SportResult;
  MLB: SportResult;
  NBA: SportResult;
  EPL: SportResult;
  PGA: SportResult;
  total: number;
};

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
          {result.rank === 0
  ? "—"
  : result.sportScore.toFixed(1)}
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
              Final sport score
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
              <span>Total</span>
              <span>{result.sportScore.toFixed(1)}</span>
            </div>
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

  const leagues = [
    {
      key: "NFL",
      data: getSeasonLeagueData(selectedYear, "NFL"),
    },
    {
      key: "MLB",
      data: getSeasonLeagueData(selectedYear, "MLB"),
    },
    {
      key: "NBA",
      data: getSeasonLeagueData(selectedYear, "NBA"),
    },
    {
      key: "EPL",
      data: getSeasonLeagueData(selectedYear, "EPL"),
    },
    {
      key: "PGA",
      data: getSeasonLeagueData(selectedYear, "PGA"),
    },
  ];

  const scoredLeagues = leagues.map(
    (league) => ({
      ...league,
      scored: scoreLeague(league.data),
    })
  );

  const allOwners = Array.from(
    new Set(
      scoredLeagues.flatMap((league) =>
        league.scored.map(
          (team) => team.team
        )
      )
    )
  );

const getSportResult = (
  owner: string,
  sport: "NFL" | "MLB" | "NBA" | "EPL" | "PGA"
): SportResult => {
  const sportSeason =
    currentSeason?.sports.find(
      (item) => item.sport === sport
    );

  if (sportSeason?.status === "upcoming") {
    return {
      rank: 0,
      fantasyPoints: 0,
      leagueAverage: 0,
      standardDeviation: 0,
      zScore: 0,
      placementPoints: 0,
      dominanceScore: 0,
      sportScore: 0,
    };
  }

  const league =
    scoredLeagues.find(
      (item) => item.key === sport
    );

  const team =
    league?.scored.find(
      (item: ScoredTeam) =>
        item.team === owner
    );

  if (!team) {
    return {
      rank: 0,
      fantasyPoints: 0,
      leagueAverage: 0,
      standardDeviation: 0,
      zScore: 0,
      placementPoints: 0,
      dominanceScore: 0,
      sportScore: 0,
    };
  }

  return {
    rank: team.rank,
    fantasyPoints: team.fantasyPoints,
    leagueAverage: team.leagueAverage,
    standardDeviation: team.standardDeviation,
    zScore: team.zScore,
    placementPoints: team.placementPoints,
    dominanceScore: team.zScore * 10,
    sportScore: team.sportScore,
  };
};



  const standings: OverallRow[] =
    allOwners.map((owner) => {
      const NFL =
        getSportResult(owner, "NFL");

      const MLB =
        getSportResult(owner, "MLB");

      const NBA =
        getSportResult(owner, "NBA");

      const EPL =
        getSportResult(owner, "EPL");

      const PGA =
        getSportResult(owner, "PGA");

      const total =
        NFL.sportScore +
        MLB.sportScore +
        NBA.sportScore +
        EPL.sportScore +
        PGA.sportScore;

      return {
        owner,
        NFL,
        MLB,
        NBA,
        EPL,
        PGA,
        total,
      };
    });

  standings.sort(
    (a, b) => b.total - a.total
  );

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-6 sm:p-8">
      <div className="mx-auto max-w-7xl">

        <nav className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-blue-200 pb-4">
          <Link
            href="/"
            className="font-bold text-blue-800"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="font-semibold text-slate-700 transition hover:text-blue-700"
          >
            Sports
          </Link>

          <Link
            href="/rosters"
            className="font-semibold text-slate-700 transition hover:text-blue-700"
          >
            Rosters
          </Link>

          <Link
            href="/scoring"
            className="font-semibold text-slate-700 transition hover:text-blue-700"
          >
            Scoring
          </Link>
        </nav>

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            Multi-Sport Fantasy League
          </h1>

          <p className="mt-2 text-sm text-slate-700 sm:text-base">
            Overall standings across all five sports
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
            View Scoring System
          </Link>
        </div>

        <p className="mb-8 text-sm font-medium text-slate-600">
          Hover over a sport score to see the scoring breakdown.
        </p>

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

                <th className="p-4 text-center font-bold text-slate-900">
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
                      {team.owner}
                    </td>

                    <SportCell result={team.NFL} />
                    <SportCell result={team.MLB} />
                    <SportCell result={team.NBA} />
                    <SportCell result={team.EPL} />
                    <SportCell result={team.PGA} />

                    <td className="p-4 text-center text-lg font-bold text-blue-900">
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
