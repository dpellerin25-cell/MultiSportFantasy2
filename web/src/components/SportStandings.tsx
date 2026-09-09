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
  const standings = scoreLeague(league).sort(
    (a, b) => a.rank - b.rank
  );

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-5 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">

        {/* NAVIGATION */}

        <nav className="mb-8 flex items-center justify-around border-b border-blue-200 pb-4 sm:justify-start sm:gap-6">
          <Link
            href="/"
            className="font-semibold text-blue-800 hover:text-blue-900 sm:text-blue-500 sm:hover:text-blue-600"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="font-semibold text-blue-900 hover:text-blue-950 sm:text-blue-700 sm:hover:text-blue-600"
          >
            Sports
          </Link>

          <Link
            href="/scoring"
            className="font-semibold text-blue-800 hover:text-blue-900 sm:text-blue-500 sm:hover:text-blue-600"
          >
            Scoring
          </Link>
        </nav>

        {/* BACK LINK */}

        <Link
          href="/sports"
          className="mb-4 inline-block text-sm font-semibold text-blue-800 hover:underline sm:text-blue-600"
        >
          ← Back to Sports
        </Link>

        {/* PAGE TITLE */}

        <h1 className="mb-2 text-3xl font-bold text-slate-900 sm:text-4xl">
          {title}
        </h1>

        <p className="mb-8 text-slate-800 sm:text-blue-500">
          Fantasy standings and championship scoring breakdown.
        </p>

        {/* STANDINGS TABLE */}

        <div className="overflow-x-auto rounded-xl border border-blue-100 bg-white shadow-sm">
          <table className="w-full min-w-[800px] border-collapse text-slate-900">
            <thead>
              <tr className="border-b border-blue-100 bg-blue-50 text-slate-900">

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
                    className="border-b border-blue-50 last:border-b-0 hover:bg-blue-50/50"
                  >
                    <td className="p-4 text-center font-bold text-slate-900">
                      {ordinal(team.rank)}
                    </td>

                    <td className="p-4 font-semibold text-slate-900">
                      {team.team}
                    </td>

                    <td className="p-4 text-right text-slate-800">
                      {team.fantasyPoints.toFixed(1)}
                    </td>

                    <td className="p-4 text-right text-slate-800">
                      {team.placementPoints.toFixed(0)}
                    </td>

                    <td className="p-4 text-right text-slate-800">
                      {team.zScore >= 0 ? "+" : ""}
                      {team.zScore.toFixed(2)}
                    </td>

                    <td className="p-4 text-right text-slate-800">
                      {dominance >= 0 ? "+" : ""}
                      {dominance.toFixed(1)}
                    </td>

                    <td className="p-4 text-right font-bold text-blue-800 sm:text-blue-700">
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
