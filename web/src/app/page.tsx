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
        <h1 className="mb-2 text-4xl font-bold">
          Multi-Sport Fantasy League
        </h1>

        <p className="mb-2 text-gray-600">
          Overall standings across all five sports
        </p>
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
