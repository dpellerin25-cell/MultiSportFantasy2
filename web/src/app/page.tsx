import Link from "next/link";

import nfl from "../../data/nfl.json";
import mlb from "../../data/mlb.json";
import nba from "../../data/nba.json";
import premierLeague from "../../data/premier-league.json";
import pga from "../../data/pga.json";

import {
  scoreLeague,
  ScoredTeam,
} from "@/lib/scoring";

const leagues = [
  {
    key: "NFL",
    data: nfl,
  },
  {
    key: "MLB",
    data: mlb,
  },
  {
    key: "NBA",
    data: nba,
  },
  {
    key: "EPL",
    data: premierLeague,
  },
  {
    key: "PGA",
    data: pga,
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
          className="min-w-20 rounded-md px-3 py-2 font-semibold text-slate-800 transition hover:bg-blue-50 focus:bg-blue-50 focus:outline-none"
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

            <div className="text-sm text-slate-500">
              Final sport score
            </div>
          </div>

          <div className="space-y-2 text-sm text-slate-700">
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

          <div className="mt-3 border-t border-blue-100 pt-3">
            <div className="flex justify-between font-bold text-blue-700">
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

function MobileSportScore({
  label,
  result,
}: {
  label: string;
  result: SportResult;
}) {
  return (
    <div className="text-center">
      <div className="text-xs font-semibold text-blue-500">
        {label}
      </div>

      <div className="mt-1 text-sm font-bold text-slate-800">
        {result.sportScore.toFixed(1)}
      </div>
    </div>
  );
}

export default function Home() {
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
    <main className="min-h-screen bg-blue-50 px-4 py-5 sm:p-8">
      <div className="mx-auto max-w-7xl">

        {/* NAVIGATION */}

        <nav className="mb-6 flex items-center justify-around border-b border-blue-200 pb-4 sm:justify-start sm:gap-8">
          <Link
            href="/"
            className="text-sm font-bold text-blue-700 sm:text-base"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="text-sm font-semibold text-blue-500 transition hover:text-blue-700 sm:text-base"
          >
            Sports
          </Link>

          <Link
            href="/scoring"
            className="text-sm font-semibold text-blue-500 transition hover:text-blue-700 sm:text-base"
          >
            Scoring
          </Link>
        </nav>

        {/* PAGE HEADER */}

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            Multi-Sport Fantasy League
          </h1>

          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Overall standings across all five sports
          </p>
        </div>

        {/* MOBILE STANDINGS */}

        <div className="space-y-3 md:hidden">
          {standings.map((team, index) => (
            <div
              key={team.owner}
              className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
            >
              <div className="mb-4 flex items-center justify-between">

                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-lg font-bold text-blue-700">
                    {index + 1}
                  </div>

                  <div>
                    <div className="text-lg font-bold text-slate-900">
                      {team.owner}
                    </div>

                    <div className="text-xs text-slate-500">
                      Overall rank
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xl font-bold text-blue-700">
                    {team.total.toFixed(1)}
                  </div>

                  <div className="text-xs text-slate-500">
                    Total points
                  </div>
                </div>

              </div>

              <div className="grid grid-cols-5 gap-1 border-t border-blue-100 pt-3">

                <MobileSportScore
                  label="NFL"
                  result={team.NFL}
                />

                <MobileSportScore
                  label="MLB"
                  result={team.MLB}
                />

                <MobileSportScore
                  label="NBA"
                  result={team.NBA}
                />

                <MobileSportScore
                  label="EPL"
                  result={team.EPL}
                />

                <MobileSportScore
                  label="PGA"
                  result={team.PGA}
                />

              </div>
            </div>
          ))}
        </div>

        {/* DESKTOP STANDINGS */}

        <div className="hidden overflow-visible rounded-xl border border-blue-100 bg-white shadow-sm md:block">
          <table className="w-full border-collapse">

            <thead>
              <tr className="border-b border-blue-100 bg-blue-50">

                <th className="p-4 text-center text-slate-700">
                  Overall
                </th>

                <th className="p-4 text-left text-slate-700">
                  Owner
                </th>

                <th className="p-4 text-center text-slate-700">
                  NFL
                </th>

                <th className="p-4 text-center text-slate-700">
                  MLB
                </th>

                <th className="p-4 text-center text-slate-700">
                  NBA
                </th>

                <th className="p-4 text-center text-slate-700">
                  EPL
                </th>

                <th className="p-4 text-center text-slate-700">
                  PGA
                </th>

                <th className="p-4 text-center text-slate-700">
                  Total
                </th>

              </tr>
            </thead>

            <tbody>
              {standings.map(
                (team, index) => (
                  <tr
                    key={team.owner}
                    className="border-b border-blue-50 transition last:border-b-0 hover:bg-blue-50/50"
                  >

                    <td className="p-4 text-center">
                      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
                        {index + 1}
                      </div>
                    </td>

                    <td className="p-4 font-semibold text-slate-900">
                      {team.owner}
                    </td>

                    <SportCell
                      result={team.NFL}
                    />

                    <SportCell
                      result={team.MLB}
                    />

                    <SportCell
                      result={team.NBA}
                    />

                    <SportCell
                      result={team.EPL}
                    />

                    <SportCell
                      result={team.PGA}
                    />

                    <td className="p-4 text-center text-lg font-bold text-blue-700">
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
