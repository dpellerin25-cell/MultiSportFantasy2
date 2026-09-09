import Link from "next/link";

const sports = [
  {
    name: "NFL",
    href: "/sports/nfl",
    description: "View NFL standings and scoring breakdown",
  },
  {
    name: "MLB",
    href: "/sports/mlb",
    description: "View MLB standings and scoring breakdown",
  },
  {
    name: "NBA",
    href: "/sports/nba",
    description: "View NBA standings and scoring breakdown",
  },
  {
    name: "Premier League",
    href: "/sports/epl",
    description: "View Premier League standings and scoring breakdown",
  },
  {
    name: "PGA",
    href: "/sports/pga",
    description: "View PGA standings and scoring breakdown",
  },
];

export default function SportsPage() {
  return (
    <main className="min-h-screen bg-blue-50 px-4 py-5 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <nav className="mb-8 flex items-center justify-around border-b border-blue-200 pb-4 sm:justify-start sm:gap-8">
          <Link
            href="/"
            className="text-sm font-semibold text-blue-800 hover:text-blue-900 sm:text-base sm:text-blue-500 sm:hover:text-blue-700"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="text-sm font-bold text-blue-900 sm:text-base sm:text-blue-700"
          >
            Sports
          </Link>

          <Link
            href="/scoring"
            className="text-sm font-semibold text-blue-800 hover:text-blue-900 sm:text-base sm:text-blue-500 sm:hover:text-blue-700"
          >
            Scoring
          </Link>
        </nav>

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            Sports
          </h1>

          <p className="mt-2 text-slate-800 sm:text-slate-600">
            View standings and championship scoring for each individual sport.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sports.map((sport) => (
            <Link
              key={sport.name}
              href={sport.href}
              className="block rounded-xl border border-blue-100 bg-white p-5 shadow-sm transition hover:border-blue-300 hover:shadow-md sm:p-6"
            >
              <h2 className="text-xl font-bold text-slate-900 sm:text-2xl sm:text-blue-700">
                {sport.name}
              </h2>

              <p className="mt-2 text-sm font-medium text-slate-800 sm:text-base sm:text-slate-600">
                {sport.description}
              </p>

              <div className="mt-4 text-sm font-bold text-blue-800 sm:text-blue-600">
                View standings →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
