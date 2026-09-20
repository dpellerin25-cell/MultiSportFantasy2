import { scoreLeague } from "./scoring";
import type { MultisportSeason } from "../config/seasons";

export const TROPHY_SPORTS = ["NFL", "MLB", "NBA", "EPL", "PGA"] as const;
export type TrophySport = typeof TROPHY_SPORTS[number];
export type TrophyCategory = "Overall" | TrophySport;
export const TROPHY_CATEGORIES: TrophyCategory[] = ["Overall", ...TROPHY_SPORTS];
export const TROPHY_LABELS: Record<TrophyCategory, string> = {
  Overall: "All-Sport Championship", NFL: "NFL", MLB: "MLB", NBA: "NBA", EPL: "Premier League", PGA: "PGA",
};

type Archive = Parameters<typeof scoreLeague>[0];
export type Championship = {
  category: TrophyCategory;
  status: "awarded" | "pending" | "tied" | "unavailable";
  owner?: string;
  score?: number;
  note?: string;
};

function validateArchive(value: unknown, sport: TrophySport): Archive {
  if (!value || typeof value !== "object") throw new Error("Invalid archive.");
  const archive = value as Archive;
  if (archive.sport !== sport && !(sport === "EPL" && archive.sport === "Premier League")) {
    throw new Error("Archive sport does not match.");
  }
  if (!Array.isArray(archive.standings) || archive.standings.length !== 9) {
    throw new Error("Expected complete standings for nine owners.");
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const row of archive.standings) {
    if (!row || typeof row.team !== "string" || !row.team.trim() || row.team !== row.team.trim() ||
        typeof row.team_id !== "string" || !row.team_id.trim() || names.has(row.team) || ids.has(row.team_id) ||
        typeof row.rank !== "string" || !row.rank.trim() || !Number.isInteger(Number(row.rank)) ||
        Number(row.rank) < 1 || Number(row.rank) > 9 ||
        typeof row.fantasyPoints !== "string" || !row.fantasyPoints.trim() || !Number.isFinite(Number(row.fantasyPoints))) {
      throw new Error("Archive contains missing, duplicate, or invalid standings.");
    }
    names.add(row.team);
    ids.add(row.team_id);
  }
  if (!archive.standings.some((row) => Number(row.rank) === 1)) throw new Error("No first-place result.");
  if (scoreLeague(archive).some((row) => !Number.isFinite(row.sportScore))) throw new Error("Invalid scoring values.");
  return archive;
}

// The injected loader is called only for configured final sports. Never award from live data.
export function deriveTrophyCase(
  seasons: MultisportSeason[],
  loadArchive: (year: number, sport: TrophySport) => unknown,
  currentOwners: string[]
) {
  const ownerNames = new Set(currentOwners);
  const history = [...seasons].sort((a, b) => b.year - a.year).map((season) => {
    const archives = new Map<TrophySport, Archive>();
    const championships: Championship[] = TROPHY_SPORTS.map((sport) => {
      if (season.sports.find((entry) => entry.sport === sport)?.status !== "final") {
        return { category: sport, status: "pending", note: "Awaiting final results" };
      }
      try {
        const archive = validateArchive(loadArchive(season.year, sport), sport);
        archives.set(sport, archive);
        archive.standings.forEach((row) => ownerNames.add(row.team));
        const winners = archive.standings.filter((row) => Number(row.rank) === 1);
        if (winners.length !== 1) {
          return { category: sport, status: "tied", note: "First-place tie · awaiting an official resolution" };
        }
        return { category: sport, status: "awarded", owner: winners[0].team };
      } catch {
        return { category: sport, status: "unavailable", note: "Final archive missing or invalid · needs review" };
      }
    });

    let overall: Championship = { category: "Overall", status: "pending", note: "Awarded after all five sports are final" };
    if (archives.size === TROPHY_SPORTS.length) {
      const leagues = TROPHY_SPORTS.map((sport) => scoreLeague(archives.get(sport)!));
      const owners = leagues[0].map((row) => row.team);
      if (leagues.some((league) => league.some((row) => !owners.includes(row.team)))) {
        overall = { category: "Overall", status: "unavailable", note: "Owner names differ between archives · needs review" };
      } else {
        const totals = owners.map((owner) => ({
          owner,
          score: leagues.reduce((total, league) => total + league.find((row) => row.team === owner)!.sportScore, 0),
        })).sort((a, b) => b.score - a.score);
        // Do not mistake insignificant floating-point differences for a league tiebreaker.
        const tied = totals.filter((entry) => Math.abs(entry.score - totals[0].score) <= 1e-9);
        overall = tied.length === 1
          ? { category: "Overall", status: "awarded", owner: totals[0].owner, score: totals[0].score }
          : { category: "Overall", status: "tied", note: "Overall score tied · awaiting an official resolution" };
      }
    } else if (championships.some((entry) => entry.status === "unavailable")) {
      overall = { category: "Overall", status: "unavailable", note: "Waiting for complete, valid final archives" };
    }

    return {
      year: season.year,
      name: season.name,
      hasFinalSport: season.sports.some((sport) => sport.status === "final"),
      championships: [overall, ...championships],
    };
  }).filter((season) => season.hasFinalSport);

  const awards = history.flatMap((season) => season.championships
    .filter((entry) => entry.status === "awarded")
    .map((entry) => ({ ...entry, year: season.year })));
  const owners = [...ownerNames].map((owner) => {
    const counts = Object.fromEntries(TROPHY_CATEGORIES.map((category) => [
      category, awards.filter((award) => award.owner === owner && award.category === category).length,
    ])) as Record<TrophyCategory, number>;
    return { owner, counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  }).sort((a, b) => b.total - a.total || b.counts.Overall - a.counts.Overall || a.owner.localeCompare(b.owner));

  return { owners, history, totalTrophies: awards.length };
}
