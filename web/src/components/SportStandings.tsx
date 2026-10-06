import {currentLeague,missingOwners} from "@/lib/current-membership";
import MainNavigation from "@/components/MainNavigation";
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
  const standings = scoreLeague(currentLeague(league)).sort(
    (a, b) => a.rank - b.rank
  );

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-5 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">

        {/* NAVIGATION */}

        <MainNavigation />

        {missingOwners(league).length>0&&<p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Awaiting Fantrax standings for {missingOwners(league).join(", ")}. Scores use the new placement table but remain provisional until the full league is refreshed.</p>}
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
        <p className="mb-6 rounded-xl border border-blue-100 bg-white p-4 text-sm font-semibold text-blue-900">
          Total Points = Placement Points + Dominance
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
                  Placement Points
                </th>

                <th className="p-4 text-right">
                  Z-Score
                </th>

                <th className="p-4 text-right">
                  Dominance
                </th>

                <th className="p-4 text-right">
                  Total Points
                  <span className="mt-1 block text-xs font-normal text-slate-600">Placement + Dominance</span>
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
              {missingOwners(league).map(owner=><tr key={owner} className="border-t border-blue-100"><td className="p-4 text-center">—</td><td className="p-4 font-semibold">{owner}</td><td colSpan={5} className="p-4 text-sm text-slate-500">Awaiting Fantrax sync</td></tr>)}
            </tbody>
          </table>
        </div>

      </div>
    </main>
  );
}
