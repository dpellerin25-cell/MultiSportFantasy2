type Standing = {
  rank: string;
  team: string;
  team_id: string;
  fantasyPoints?: string;
  [key: string]: string | undefined;
};

type LeagueData = {
  sport: string;
  standings: Standing[];
  placement_points?: number[];
};

export type ScoredTeam = {
  team: string;
  rank: number;
  fantasyPoints: number;
  leagueAverage: number;
  standardDeviation: number;
  zScore: number;
  placementPoints: number;
  sportScore: number;
};

// Fallback only for legacy nine-owner snapshots without an archived table.
// Current seasons supply their approved table through current-membership.ts.
const LEGACY_PLACEMENT_POINTS: Record<number, number> = {
  1: 100,
  2: 80,
  3: 65,
  4: 52,
  5: 40,
  6: 30,
  7: 20,
  8: 10,
  9: 0,
};

function getAverage(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return (
    values.reduce((sum, value) => sum + value, 0) /
    values.length
  );
}

function getStandardDeviation(
  values: number[],
  average: number
) {
  if (values.length === 0) {
    return 0;
  }

  const squaredDifferences = values.map(
    (value) => (value - average) ** 2
  );

  const variance =
    squaredDifferences.reduce(
      (sum, value) => sum + value,
      0
    ) / values.length;

  return Math.sqrt(variance);
}

export function scoreLeague(
  league: LeagueData
): ScoredTeam[] {
  const points = league.placement_points ?? (league.standings.length === 9 ? Object.values(LEGACY_PLACEMENT_POINTS) : undefined);
  if (!points || points.length !== league.standings.length || points.some((p,i) => !Number.isFinite(p) || p < 0 || (i > 0 && p >= points[i-1]))) {
    throw new Error("An approved placement table matching this season's owner count is required.");
  }
  const fantasyPoints = league.standings.map(
    (team) => Number(team.fantasyPoints ?? 0)
  );

  const leagueAverage =
    getAverage(fantasyPoints);

  const standardDeviation =
    getStandardDeviation(
      fantasyPoints,
      leagueAverage
    );

  return league.standings.map((team) => {
    const rank = Number(team.rank);

    const teamPoints = Number(
      team.fantasyPoints ?? 0
    );

    const zScore =
      standardDeviation === 0
        ? 0
        : (teamPoints - leagueAverage) /
          standardDeviation;

    const placementPoints =
      points[rank - 1] ?? 0;

    const sportScore =
      placementPoints + 10 * zScore;

    return {
      team: team.team,
      rank,
      fantasyPoints: teamPoints,
      leagueAverage,
      standardDeviation,
      zScore,
      placementPoints,
      sportScore,
    };
  });
}
