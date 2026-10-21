import {currentLeague} from "./current-membership";
import {belongsToLiveChampionship} from "./seasonSnapshot";
import fs from "fs";
import path from "path";

import nfl from "../../data/nfl.json";
import mlb from "../../data/mlb.json";
import nba from "../../data/nba.json";
import premierLeague from "../../data/premier-league.json";
import pga from "../../data/pga.json";

import {
  getSeason,
  SportSeason,
} from "@/config/seasons";

type Standing = {
  rank: string;
  team: string;
  team_id: string;
  fantasyPoints?: string;
  [key: string]: string | undefined;
};

export type LeagueData = {
  sport: string;
  updated_at?: string;
  championship_year?: number;
  placement_points?: number[];
  standings: Standing[];
};

const liveData: Record<
  SportSeason["sport"],
  LeagueData
> = {
  NFL: nfl,
  MLB: mlb,
  NBA: nba,
  EPL: premierLeague,
  PGA: pga,
};

const archiveFilenames: Record<
  SportSeason["sport"],
  string
> = {
  NFL: "nfl.json",
  MLB: "mlb.json",
  NBA: "nba.json",
  EPL: "premier-league.json",
  PGA: "pga.json",
};

function getArchivedData(
  year: number,
  sport: SportSeason["sport"]
): LeagueData {
  const filename = archiveFilenames[sport];

  const archivePath = path.join(
    process.cwd(),
    "data",
    "history",
    String(year),
    filename
  );

  if (!fs.existsSync(archivePath)) {
    throw new Error(
      `${sport} is marked final for the ${year} Pentagon Cup, ` +
        `but its archive does not exist: ${archivePath}`
    );
  }

  const fileContents = fs.readFileSync(
    archivePath,
    "utf-8"
  );

  const data = JSON.parse(fileContents) as LeagueData;
  if (data.championship_year !== year) throw new Error("Archive championship year mismatch");
  return data;
}

export function getSeasonLeagueData(
  year: number,
  sport: SportSeason["sport"]
): LeagueData {
  const season = getSeason(year);

  if (!season) {
    throw new Error(
      `Pentagon Cup season ${year} does not exist.`
    );
  }

  const sportSeason = season.sports.find(
    (item) => item.sport === sport
  );

  if (!sportSeason) {
    throw new Error(
      `${sport} is not configured for the ${year} Pentagon Cup.`
    );
  }

  if (sportSeason.status === "final") {
    return getArchivedData(year, sport);
  }

  const data = liveData[sport];
  // A single latest snapshot must never leak into an overlapping championship.
  if (!belongsToLiveChampionship(sportSeason.status, year, data.championship_year)) {
    return {sport: data.sport, standings: []};
  }
  return currentLeague(data);
}
