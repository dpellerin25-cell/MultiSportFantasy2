import Link from "next/link";
const placementPoints = [
  { finish: "1st", points: 100 },
  { finish: "2nd", points: 80 },
  { finish: "3rd", points: 65 },
  { finish: "4th", points: 52 },
  { finish: "5th", points: 40 },
  { finish: "6th", points: 30 },
  { finish: "7th", points: 20 },
  { finish: "8th", points: 10 },
  { finish: "9th", points: 0 },
];

export default function ScoringPage() {
  return (
    <main className="min-h-screen bg-blue-50 p-8">
      <div className="mx-auto max-w-4xl">
<nav className="mb-8 flex items-center gap-6 border-b border-blue-200 pb-4">
  <Link
    href="/"
    className="font-semibold text-blue-700 hover:text-blue-600"
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
    className="font-semibold text-blue-700 hover:text-blue-600"
  >
    Scoring
  </Link>
</nav>
        <h1 className="mb-2 text-4xl font-bold text-slate-900 sm:text-inherit">
          Scoring System
        </h1>

        <p className="mb-8 text-blue-700">
          Each sport rewards both finishing position and dominance.
        </p>

        <section className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-bold text-slate-900 sm:text-inherit">
            Formula
          </h2>

          <div className="rounded-md bg-blue-50 p-4 text-center">
            <p className="text-lg font-semibold text-slate-900 sm:text-inherit">
              Sport Score = Placement Points + Dominance Score
            </p>

            <p className="mt-2 text-blue-700">
              Dominance Score = 10 × Z-Score
            </p>

            <p className="mt-2 text-slate-700">
              Z-Score = (Team Fantasy Points - League Average) ÷ Standard Deviation
            </p>
          </div>
        </section>

        <section className="mb-8 rounded-lg bg-white p-6 shadow text-slate-900 sm:text-inherit">
          <h2 className="mb-4 text-2xl font-bold text-slate-900 sm:text-inherit">
            Placement Points
          </h2>

          <div className="overflow-hidden rounded-md border">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-blue-50">
                  <th className="border-b p-3 text-left">
                    Finish
                  </th>
                  <th className="border-b p-3 text-right">
                    Points
                  </th>
                </tr>
              </thead>

              <tbody>
                {placementPoints.map((row) => (
                  <tr key={row.finish} className="border-b last:border-b-0">
                    <td className="p-3">
                      {row.finish}
                    </td>

                    <td className="p-3 text-right font-semibold">
                      {row.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-8 rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-bold">
            Dominance Score
          </h2>

          <p className="mb-4 text-slate-700">
            The dominance portion rewards teams that outperform the league
            average by a larger margin and penalizes teams that finish below
            the league average.
          </p>

          <div className="space-y-2 rounded-md bg-blue-50 p-4">
            <p>
              A Z-score of <strong>+1.50</strong> adds{" "}
              <strong>+15.0 points</strong>.
            </p>

            <p>
              A Z-score of <strong>+0.50</strong> adds{" "}
              <strong>+5.0 points</strong>.
            </p>

            <p>
              A Z-score of <strong>-0.75</strong> subtracts{" "}
              <strong>7.5 points</strong>.
            </p>
          </div>
        </section>

        <section className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-2xl font-bold">
            Example
          </h2>

          <div className="space-y-2 text-slate-700">
            <p>
              A team finishes <strong>2nd</strong>, worth{" "}
              <strong>80 placement points</strong>.
            </p>

            <p>
              The team scores <strong>1.25 standard deviations</strong> above
              the league average.
            </p>

            <p>
              Dominance Score = 10 × 1.25 ={" "}
              <strong>+12.5</strong>.
            </p>

            <div className="mt-4 rounded-md bg-blue-50 p-4 text-lg font-bold">
              Final Sport Score = 80 + 12.5 = 92.5
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
