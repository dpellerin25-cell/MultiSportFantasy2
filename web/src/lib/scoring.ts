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

const PLACEMENT_POINTS: Record<number, number> = {
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
      PLACEMENT_POINTS[rank] ?? 0;

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
