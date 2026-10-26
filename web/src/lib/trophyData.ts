import { seasons } from "@/config/seasons";
import { getSeasonLeagueData } from "@/lib/seasonData";
import { deriveTrophyCase } from "@/lib/trophies";
import settings from "../../data/league-settings.json";

export function getTrophyCase() {
  // Current names seed zero-trophy owner cards only; live results never award trophies.
  // getSeasonLeagueData reads data/history/<year>/ for every final sport.
  return deriveTrophyCase(seasons, getSeasonLeagueData, settings.owners.map((owner) => owner.name));
}
