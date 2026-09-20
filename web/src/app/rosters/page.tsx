import MainNavigation from "@/components/MainNavigation";
import { connection } from "next/server";
import { RookieDraftProvider, OwnerRookiePicks } from "@/components/RookieDraft";
import { buildRookiePicks, getDraftYears } from "@/lib/rookieDraft";
import { readDraftLedger, canWriteDrafts } from "@/lib/rookieDraftStore";

import nfl from "../../../data/rosters/nfl.json";
import mlb from "../../../data/rosters/mlb.json";
import nba from "../../../data/rosters/nba.json";
import premierLeague from "../../../data/rosters/premier-league.json";
import pga from "../../../data/rosters/pga.json";

import RosterCard, {
  RosterPlayer,
  SportRoster,
} from "@/components/RosterCard";

type ImportedRoster = {
  owner: string;
  team_id: string;
  player_count: number;
  players: RosterPlayer[];
};

type ImportedRosterFile = {
  sport: string;
  league_id: string;
  updated_at: string;
  team_count: number;
  total_players: number;
  rosters: ImportedRoster[];
};

const leagues: {
  sport: string;
  data: ImportedRosterFile;
}[] = [
  {
    sport: "NFL",
    data: nfl,
  },
  {
    sport: "MLB",
    data: mlb,
  },
  {
    sport: "NBA",
    data: nba,
  },
  {
    sport: "Premier League",
    data: premierLeague,
  },
  {
    sport: "PGA",
    data: pga,
  },
];

type OwnerRoster = {
  owner: string;
  sports: SportRoster[];
  totalPlayers: number;
};

function buildCombinedRosters(): OwnerRoster[] {
  const owners = new Map<string, OwnerRoster>();

  for (const league of leagues) {
    for (const roster of league.data.rosters) {
      if (!owners.has(roster.owner)) {
        owners.set(roster.owner, {
          owner: roster.owner,
          sports: [],
          totalPlayers: 0,
        });
      }

      const owner = owners.get(roster.owner);

      if (!owner) {
        continue;
      }

      owner.sports.push({
        sport: league.sport,
        players: roster.players,
      });

      owner.totalPlayers += roster.players.length;
    }
  }

  const sportOrder = [
    "NFL",
    "MLB",
    "NBA",
    "Premier League",
    "PGA",
  ];

  for (const owner of owners.values()) {
    for (const sport of sportOrder) {
      if (
        !owner.sports.some(
          (ownerSport) => ownerSport.sport === sport
        )
      ) {
        owner.sports.push({
          sport,
          players: [],
        });
      }
    }

    owner.sports.sort(
      (a, b) =>
        sportOrder.indexOf(a.sport) -
        sportOrder.indexOf(b.sport)
    );
  }

  return Array.from(owners.values()).sort((a, b) =>
    a.owner.localeCompare(b.owner)
  );
}

export default async function RostersPage() {
  await connection();
  const owners = buildCombinedRosters();
  const ledger = await readDraftLedger();
  const years = getDraftYears();
  const draft = {
    years,
    picks: buildRookiePicks(ledger, years),
    trades: ledger.trades.filter((trade) => years.includes(trade.year)),
    editingAvailable: canWriteDrafts(),
  };

  return (
    <main className="min-h-screen bg-blue-50 px-4 py-5 text-slate-900 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <MainNavigation />

        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            Rosters
          </h1>

          <p className="mt-2 max-w-2xl text-slate-800 sm:text-slate-600">
            Combined rosters across all five sports. Each owner
            can roster a maximum of 65 players.
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-600">
                Global roster cap
              </p>

              <p className="mt-1 text-lg font-bold text-slate-900">
                65 players per owner
              </p>
            </div>

            <div className="rounded-full bg-blue-100 px-4 py-2 text-sm font-bold text-blue-800">
              NFL + MLB + NBA + EPL + PGA
            </div>
          </div>
        </div>

        <RookieDraftProvider initial={draft}>
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {owners.map((owner) => (
            <RosterCard
              key={owner.owner}
              owner={owner.owner}
              sports={owner.sports}
              maxRosterSize={65}
            >
              <OwnerRookiePicks owner={owner.owner} />
            </RosterCard>
          ))}
        </div>
        </RookieDraftProvider>
      </div>
    </main>
  );
}
