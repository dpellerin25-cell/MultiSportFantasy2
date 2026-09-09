import Link from "next/link";
import {
  scoreLeague,
} from "@/lib/scoring";

type Standing = {
  rank: string;
  team: string;
  team_id: string;
  fantasyPoints?: string;
  [key: string]: string | undefined;
};

type LeagueData = {
  sport: string;
  standings: Standing[];
};

type SportStandingsProps = {
  title: string;
  league: LeagueData;
};

function ordinal(rank: number) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";

  return `${rank}th`;
}

export default function SportStandings({
  title,
  league,
}: SportStandingsProps) {
  const standings = scoreLeague(league)
    .sort(
      (a, b) =>
        a.rank - b.rank
    );

  return (
    <main className="min-h-screen bg-blue-50 p-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex items-center gap-6 border-b border-blue-200 pb-4">
          <Link
            href="/"
            className="font-semibold text-blue-500 hover:text-blue-600"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="font-semibold text-blue-700 hover:text-blue-600"
          >
            Sports
          </Link>

          <Link
            href="/scoring"
            className="font-semibold text-blue-500 hover:text-blue-600"
          >
            Scoring
          </Link>
        </nav>

        <Link
          href="/sports"
          className="mb-4 inline-block text-sm font-semibold text-blue-600 hover:underline"
        >
          ← Back to Sports
        </Link>

        <h1 className="mb-2 text-4xl font-bold">
          {title}
        </h1>

        <p className="mb-8 text-blue-500">
          Fantasy standings and championship scoring breakdown.
        </p>

        <div className="overflow-x-auto rounded-lg bg-white shadow">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b bg-blue-50">
                <th className="p-4 text-center">
                  Finish
                </th>

                <th className="p-4 text-left">
                  Owner
                </th>

                <th className="p-4 text-right">
                  Fantasy Points
                </th>

                <th className="p-4 text-right">
                  Placement
                </th>

                <th className="p-4 text-right">
                  Z-Score
                </th>

                <th className="p-4 text-right">
                  Dominance
                </th>

                <th className="p-4 text-right">
                  Sport Score
                </th>
              </tr>
            </thead>

            <tbody>
              {standings.map((team) => {
                const dominance =
                  team.zScore * 10;

                return (
                  <tr
                    key={team.team}
                    className="border-b last:border-b-0"
                  >
                    <td className="p-4 text-center font-bold">
                      {ordinal(team.rank)}
                    </td>

                    <td className="p-4 font-medium">
                      {team.team}
                    </td>

                    <td className="p-4 text-right">
                      {team.fantasyPoints.toFixed(1)}
                    </td>

                    <td className="p-4 text-right">
                      {team.placementPoints.toFixed(0)}
                    </td>

                    <td className="p-4 text-right">
                      {team.zScore >= 0 ? "+" : ""}
                      {team.zScore.toFixed(2)}
                    </td>

                    <td className="p-4 text-right">
                      {dominance >= 0 ? "+" : ""}
                      {dominance.toFixed(1)}
                    </td>

                    <td className="p-4 text-right font-bold">
                      {team.sportScore.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

