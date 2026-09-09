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

  return (
    <td className="p-4 text-center">
      <div className="font-bold">
        {ordinal(result.rank)}
      </div>

      <div className="text-sm text-gray-600">
        {result.placementPoints.toFixed(0)} placement
      </div>

      <div className="text-sm text-gray-600">
        {dominance} dominance
      </div>

      <div className="mt-1 font-semibold">
        {result.sportScore.toFixed(1)} pts
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
        placementPoints: 0,
        dominanceScore: 0,
        sportScore: 0,
      };
    }

    return {
      rank: team.rank,
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

        <p className="mb-8 text-gray-600">
          Overall standings across all five sports
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