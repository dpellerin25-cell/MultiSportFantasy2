export type SportStatus =
  | "upcoming"
  | "live"
  | "final";

export type SportSeason = {
  sport: "NFL" | "MLB" | "NBA" | "EPL" | "PGA";
  label: string;
  status: SportStatus;
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
      },
      {
        sport: "NBA",
        label: "2026–27 NBA",
        status: "upcoming",
      },
      {
        sport: "EPL",
        label: "2026–27 Premier League",
        status: "live",
      },
      {
        sport: "PGA",
        label: "2027 PGA",
        status: "upcoming",
      },
      {
        sport: "MLB",
        label: "2027 MLB",
        status: "upcoming",
      },
    ],
  },
];

export const CURRENT_SEASON = 2027;

export function getSeason(year: number) {
  return seasons.find(
    (season) => season.year === year
  );
}
