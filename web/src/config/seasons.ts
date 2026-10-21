import calendar from "../../data/championship-calendar.json";

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

export const seasons: MultisportSeason[] = [2027, 2028].map(year => ({
  year,
  name: `${year} Pentagon Cup`,
  sports: (Object.keys(calendar.sports) as SportSeason["sport"][]).map(sport => {
    const rule = calendar.sports[sport];
    return {sport, label: `${rule.spans_calendar_years ? `${year}–${String(year+1).slice(-2)}` : year} ${rule.label}`, status: "upcoming"};
  }),
}));

export const CURRENT_SEASON = 2027;

export function getSeason(year: number) {
  return seasons.find(
    (season) => season.year === year
  );
}
