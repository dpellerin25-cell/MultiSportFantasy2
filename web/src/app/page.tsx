import nfl from "../../data/nfl.json";
import mlb from "../../data/mlb.json";
import nba from "../../data/nba.json";
import premierLeague from "../../data/premier-league.json";
import pga from "../../data/pga.json";

type Standing = {
  rank: string;
  team: string;
  team_id: string;
  [key: string]: string | undefined;
};

type LeagueData = {
  sport: string;
  standings: Standing[];
};

const leagues: LeagueData[] = [
  nfl,
  mlb,
  nba,
  premierLeague,
  pga,
];

export default function Home() {
  const allOwners = Array.from(
    new Set(
      leagues.flatMap((league) =>
        league.standings.map((team) => team.team)
      )
    )
  ).sort();

  const getRank = (league: LeagueData, owner: string) => {
    const team = league.standings.find(
      (entry) => entry.team === owner
    );

    return team?.rank ?? "-";
  };

  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-2 text-4xl font-bold">
          Multi-Sport Fantasy League
        </h1>

        <p className="mb-8 text-gray-600">
          Combined standings across all five leagues
        </p>

        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-4 text-left">Owner</th>
                <th className="p-4 text-center">NFL</th>
                <th className="p-4 text-center">MLB</th>
                <th className="p-4 text-center">NBA</th>
                <th className="p-4 text-center">
                  Premier League
                </th>
                <th className="p-4 text-center">PGA</th>
              </tr>
            </thead>

            <tbody>
              {allOwners.map((owner) => (
                <tr
                  key={owner}
                  className="border-b last:border-b-0"
                >
                  <td className="p-4 font-medium">
                    {owner}
                  </td>

                  <td className="p-4 text-center">
                    {getRank(nfl, owner)}
                  </td>

                  <td className="p-4 text-center">
                    {getRank(mlb, owner)}
                  </td>

                  <td className="p-4 text-center">
                    {getRank(nba, owner)}
                  </td>

                  <td className="p-4 text-center">
                    {getRank(premierLeague, owner)}
                  </td>

                  <td className="p-4 text-center">
                    {getRank(pga, owner)}
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