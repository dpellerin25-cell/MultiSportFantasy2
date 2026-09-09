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
  <main className="min-h-screen bg-gray-100 px-4 py-5 sm:p-8">
    <div className="mx-auto max-w-7xl">

      <nav className="mb-6 flex items-center justify-around border-b border-gray-300 pb-4 sm:justify-start sm:gap-8">
        <Link
          href="/"
          className="text-sm font-bold text-gray-900 sm:text-base"
        >
          Standings
        </Link>

        <Link
          href="/sports"
          className="text-sm font-semibold text-gray-600 hover:text-blue-600 sm:text-base"
        >
          Sports
        </Link>

        <Link
          href="/scoring"
          className="text-sm font-semibold text-gray-600 hover:text-blue-600 sm:text-base"
        >
          Scoring
        </Link>
      </nav>

      <h1 className="text-3xl font-bold sm:text-4xl">
        Multi-Sport Fantasy League
      </h1>

      <p className="mb-6 mt-2 text-sm text-gray-600 sm:text-base">
        Overall standings across all five sports
      </p>

      {/* MOBILE STANDINGS */}

      <div className="space-y-3 md:hidden">
        {standings.map((team, index) => (
          <div
            key={team.owner}
            className="rounded-xl bg-white p-4 shadow"
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="text-xl font-bold text-gray-500">
                  #{index + 1}
                </div>

                <div className="text-lg font-bold">
                  {team.owner}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xl font-bold">
                  {team.total.toFixed(1)}
                </div>

                <div className="text-xs text-gray-500">
                  Total Points
                </div>
              </div>
            </div>

            <div className="grid grid-cols-5 gap-1 border-t pt-3">
              <div className="text-center">
                <div className="text-xs font-semibold text-gray-500">
                  NFL
                </div>
                <div className="mt-1 font-bold">
                  {team.NFL.sportScore.toFixed(1)}
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-semibold text-gray-500">
                  MLB
                </div>
                <div className="mt-1 font-bold">
                  {team.MLB.sportScore.toFixed(1)}
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-semibold text-gray-500">
                  NBA
                </div>
                <div className="mt-1 font-bold">
                  {team.NBA.sportScore.toFixed(1)}
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-semibold text-gray-500">
                  EPL
                </div>
                <div className="mt-1 font-bold">
                  {team.EPL.sportScore.toFixed(1)}
                </div>
              </div>

              <div className="text-center">
                <div className="text-xs font-semibold text-gray-500">
                  PGA
                </div>
                <div className="mt-1 font-bold">
                  {team.PGA.sportScore.toFixed(1)}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* DESKTOP STANDINGS */}

      <div className="hidden overflow-visible rounded-lg bg-white shadow md:block">
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
            {standings.map((team, index) => (
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </main>
);
}

