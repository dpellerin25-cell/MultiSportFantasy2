import Link from "next/link";
import { getSeasonLeagueData } from "@/lib/seasonData";

import {
  scoreLeague,
  ScoredTeam,
} from "@/lib/scoring";

import {
  CURRENT_SEASON,
  getSeason,
} from "@/config/seasons";

const leagues = [
  {
    key: "NFL",
    data: getSeasonLeagueData(CURRENT_SEASON, "NFL"),
  },
  {
    key: "MLB",
    data: getSeasonLeagueData(CURRENT_SEASON, "MLB"),
  },
  {
    key: "NBA",
    data: getSeasonLeagueData(CURRENT_SEASON, "NBA"),
  },
  {
    key: "EPL",
    data: getSeasonLeagueData(CURRENT_SEASON, "EPL"),
  },
  {
    key: "PGA",
    data: getSeasonLeagueData(CURRENT_SEASON, "PGA"),
  },
];

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
          className="min-w-20 rounded-md px-3 py-2 font-semibold hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
        >
          {result.sportScore.toFixed(1)}
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
            rounded-lg
            border
            border-gray-200
            bg-white
            p-4
            text-left
            shadow-xl
            group-hover:block
            group-focus-within:block
          "
        >
          <div className="mb-3 border-b pb-2">
            <div className="text-lg font-bold">
              {result.sportScore.toFixed(1)} points
            </div>

            <div className="text-sm text-gray-500">
              Final sport score
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span>Finish</span>
              <span className="font-semibold">
                {ordinal(result.rank)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Placement points</span>
              <span className="font-semibold">
                {result.placementPoints.toFixed(0)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Fantasy points</span>
              <span className="font-semibold">
                {result.fantasyPoints.toFixed(1)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>League average</span>
              <span className="font-semibold">
                {result.leagueAverage.toFixed(1)}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Z-score</span>
              <span className="font-semibold">
                {zScore}
              </span>
            </div>

            <div className="flex justify-between">
              <span>Dominance</span>
              <span className="font-semibold">
                {dominance}
              </span>
            </div>
          </div>

          <div className="mt-3 border-t pt-3">
            <div className="flex justify-between font-bold">
              <span>Total</span>
              <span>
                {result.sportScore.toFixed(1)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </td>
  );
}

export default function Home() {
  const currentSeason = getSeason(CURRENT_SEASON);
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
    sport: string
  ): SportResult => {
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
      fantasyPoints:
        team.fantasyPoints,
      leagueAverage:
        team.leagueAverage,
      standardDeviation:
        team.standardDeviation,
      zScore:
        team.zScore,
      placementPoints:
        team.placementPoints,
      dominanceScore:
        team.zScore * 10,
      sportScore:
        team.sportScore,
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
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-7xl">
<nav className="mb-8 flex items-center gap-6 border-b border-gray-300 pb-4">
  <Link
    href="/"
    className="font-semibold text-gray-900 hover:text-blue-600"
  >
    Standings
  </Link>

  <Link
    href="/sports"
    className="font-semibold text-gray-600 hover:text-blue-600"
  >
    Sports
  </Link>

  <Link
    href="/scoring"
    className="font-semibold text-gray-600 hover:text-blue-600"
  >
    Scoring
  </Link>
</nav>
        <div className="mb-6">
  <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
    Multi-Sport Fantasy League
  </h1>

  <p className="mt-2 text-sm text-slate-600 sm:text-base">
    Overall standings across all five sports
  </p>

  {currentSeason && (
    <>
      <div className="mt-3 inline-flex rounded-full border border-blue-200 bg-white px-3 py-1.5 text-sm font-bold text-blue-800 shadow-sm">
        {currentSeason.name}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {currentSeason.sports.map((sport) => (
          <div
            key={sport.sport}
            className="flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 shadow-sm"
          >
            <span className="text-xs font-semibold text-slate-800 sm:text-sm">
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
    className="font-semibold text-blue-600 hover:underline"
  >
    View Scoring System
  </Link>
</div>
        <p className="mb-8 text-sm text-gray-500">
          Hover over a sport score to see the scoring breakdown.
        </p>

        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-4 text-center">
                  Overall
                </th>

                <th className="p-4 text-left">
                  Owner
                </th>

                <th className="p-4 text-center">
                  NFL
                </th>

                <th className="p-4 text-center">
                  MLB
                </th>

                <th className="p-4 text-center">
                  NBA
                </th>

                <th className="p-4 text-center">
                  EPL
                </th>

                <th className="p-4 text-center">
                  PGA
                </th>

                <th className="p-4 text-center">
                  Total
                </th>
              </tr>
            </thead>

            <tbody>
              {standings.map(
                (team, index) => (
                  <tr
                    key={team.owner}
                    className="border-b last:border-b-0"
                  >
                    <td className="p-4 text-center text-lg font-bold">
                      {index + 1}
                    </td>

                    <td className="p-4 font-medium">
                      {team.owner}
                    </td>

                    <SportCell result={team.NFL} />
                    <SportCell result={team.MLB} />
                    <SportCell result={team.NBA} />
                    <SportCell result={team.EPL} />
                    <SportCell result={team.PGA} />

                    <td className="p-4 text-center text-lg font-bold">
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
