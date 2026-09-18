export type SportSeason = {
  sport: string;
  label: string;
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
      },
      {
        sport: "NBA",
        label: "2026–27 NBA",
      },
      {
        sport: "Premier League",
        label: "2026–27 Premier League",
      },
      {
        sport: "PGA",
        label: "2027 PGA",
      },
      {
        sport: "MLB",
        label: "2027 MLB",
      },
    ],
  },
];

export const CURRENT_SEASON = 2027;

export function getSeason(year: number) {
  return seasons.find((season) => season.year === year);
}
