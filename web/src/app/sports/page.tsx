import Link from "next/link";

const sports = [
  {
    name: "NFL",
    href: "/sports/nfl",
  },
  {
    name: "MLB",
    href: "/sports/mlb",
  },
  {
    name: "NBA",
    href: "/sports/nba",
  },
  {
    name: "Premier League",
    href: "/sports/epl",
  },
  {
    name: "PGA",
    href: "/sports/pga",
  },
];

export default function SportsPage() {
  return (
    <main className="min-h-screen bg-gray-100 p-8">
      <div className="mx-auto max-w-5xl">
        <nav className="mb-8 flex items-center gap-6 border-b border-gray-300 pb-4">
          <Link
            href="/"
            className="font-semibold text-gray-600 hover:text-blue-600"
          >
            Standings
          </Link>

          <Link
            href="/sports"
            className="font-semibold text-gray-900 hover:text-blue-600"
          >
            Sports
          </Link>

          <Link
            href="/scoring"
            className="font-semibold text-gray-600 hover:text-blue-600"
          >
            Scoring
          </Link>
        </nav>

        <h1 className="mb-2 text-4xl font-bold">
          Sports
        </h1>

        <p className="mb-8 text-gray-600">
          View the standings and championship scoring for each individual sport.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          {sports.map((sport) => (
            <Link
              key={sport.name}
              href={sport.href}
              className="rounded-lg bg-white p-6 shadow transition hover:shadow-md"
            >
              <h2 className="text-2xl font-bold">
                {sport.name}
              </h2>

              <p className="mt-2 text-gray-600">
                View standings and scoring breakdown
              </p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
