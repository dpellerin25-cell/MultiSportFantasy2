export type SportStatus = "upcoming" | "live" | "final";

export type SportSeason = {
  sport: "NFL" | "MLB" | "NBA" | "EPL" | "PGA";
  label: string;
  status: SportStatus;
  liveDataFile: string;
  archiveDataFile: string;
};

export type MultisportSeason = {
  year: number;
  name: string;
  sports: SportSeason[];
};

export const seasons: MultisportSeason[] = [
  {
    year: 2027,
    name: "2027 Championship",
    sports: [
      {
        sport: "NFL",
        label: "2026–27 NFL",
        status: "live",
        liveDataFile: "nfl.json",
        archiveDataFile: "history/2027/nfl.json",
      },
      {
        sport: "NBA",
        label: "2026–27 NBA",
        status: "live",
        liveDataFile: "nba.json",
        archiveDataFile: "history/2027/nba.json",
      },
      {
        sport: "EPL",
        label: "2026–27 Premier League",
        status: "live",
        liveDataFile: "premier-league.json",
        archiveDataFile: "history/2027/premier-league.json",
      },
      {
        sport: "PGA",
        label: "2027 PGA",
        status: "live",
        liveDataFile: "pga.json",
        archiveDataFile: "history/2027/pga.json",
      },
      {
        sport: "MLB",
        label: "2027 MLB",
        status: "live",
        liveDataFile: "mlb.json",
        archiveDataFile: "history/2027/mlb.json",
      },
    ],
  },
];

export const CURRENT_SEASON = 2027;

export function getSeason(year: number) {
  return seasons.find((season) => season.year === year);
}

export function getSportSeason(
  year: number,
  sport: SportSeason["sport"]
) {
  return getSeason(year)?.sports.find(
    (item) => item.sport === sport
  );
}
