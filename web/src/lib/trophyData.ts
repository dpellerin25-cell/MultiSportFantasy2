import { seasons } from "@/config/seasons";
import { getSeasonLeagueData } from "@/lib/seasonData";
import { deriveTrophyCase } from "@/lib/trophies";
import nfl from "../../data/nfl.json";

export function getTrophyCase() {
  // Current names seed zero-trophy owner cards only; live results never award trophies.
  // getSeasonLeagueData reads data/history/<year>/ for every final sport.
  return deriveTrophyCase(seasons, getSeasonLeagueData, nfl.standings.map((row) => row.team));
}
