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

type OverallRow = {
  owner: string;
  NFL: number;
  MLB: number;
  NBA: number;
  EPL: number;
  PGA: number;
  total: number;
};

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

  const standings: OverallRow[] =
    allOwners.map((owner) => {
      const getScore = (
        sport: string
      ) => {
        const league =
          scoredLeagues.find(
            (item) => item.key === sport
          );

        const team =
          league?.scored.find(
            (item: ScoredTeam) =>
              item.team === owner
          );

        return team?.sportScore ?? 0;
      };

      const NFL = getScore("NFL");
      const MLB = getScore("MLB");
      const NBA = getScore("NBA");
      const EPL = getScore("EPL");
      const PGA = getScore("PGA");

      return {
        owner,
        NFL,
        MLB,
        NBA,
        EPL,
        PGA,
        total:
          NFL +
          MLB +
          NBA +
          EPL +
          PGA,
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
                    <td className="p-4 text-center font-bold">
                      {index + 1}
                    </td>

                    <td className="p-4 font-medium">
                      {team.owner}
                    </td>

                    <td className="p-4 text-center">
                      {team.NFL.toFixed(1)}
                    </td>

                    <td className="p-4 text-center">
                      {team.MLB.toFixed(1)}
                    </td>

                    <td className="p-4 text-center">
                      {team.NBA.toFixed(1)}
                    </td>

                    <td className="p-4 text-center">
                      {team.EPL.toFixed(1)}
                    </td>

                    <td className="p-4 text-center">
                      {team.PGA.toFixed(1)}
                    </td>

                    <td className="p-4 text-center font-bold">
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
