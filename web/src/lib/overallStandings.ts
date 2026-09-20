import { getSeason } from "@/config/seasons";
import { getSeasonLeagueData } from "@/lib/seasonData";
import { scoreLeague, type ScoredTeam } from "@/lib/scoring";

export type SportResult = {
  rank: number;
  fantasyPoints: number;
  leagueAverage: number;
  standardDeviation: number;
  zScore: number;
  placementPoints: number;
  dominanceScore: number;
  sportScore: number;
};

export type OverallRow = {
  owner: string;
  NFL: SportResult;
  MLB: SportResult;
  NBA: SportResult;
  EPL: SportResult;
  PGA: SportResult;
  total: number;
};

export function getOverallStandings(selectedYear: number): OverallRow[] {
  const currentSeason = getSeason(selectedYear);

  const leagues = [
    {
      key: "NFL",
      data: getSeasonLeagueData(selectedYear, "NFL"),
    },
    {
      key: "MLB",
      data: getSeasonLeagueData(selectedYear, "MLB"),
    },
    {
      key: "NBA",
      data: getSeasonLeagueData(selectedYear, "NBA"),
    },
    {
      key: "EPL",
      data: getSeasonLeagueData(selectedYear, "EPL"),
    },
    {
      key: "PGA",
      data: getSeasonLeagueData(selectedYear, "PGA"),
    },
  ];

  const scoredLeagues = leagues.map(
    (league) => ({
      ...league,
      scored: scoreLeague(league.data),
    })
  );

  const allOwners = Array.from(
    new Set(
      scoredLeagues.flatMap((league) =>
        league.scored.map(
          (team) => team.team
        )
      )
    )
  );

const getSportResult = (
  owner: string,
  sport: "NFL" | "MLB" | "NBA" | "EPL" | "PGA"
): SportResult => {
  const sportSeason =
    currentSeason?.sports.find(
      (item) => item.sport === sport
    );

  if (sportSeason?.status === "upcoming") {
    return {
      rank: 0,
      fantasyPoints: 0,
      leagueAverage: 0,
      standardDeviation: 0,
      zScore: 0,
      placementPoints: 0,
      dominanceScore: 0,
      sportScore: 0,
    };
  }

  const league =
    scoredLeagues.find(
      (item) => item.key === sport
    );

  const team =
    league?.scored.find(
      (item: ScoredTeam) =>
        item.team === owner
    );

  if (!team) {
    return {
      rank: 0,
      fantasyPoints: 0,
      leagueAverage: 0,
      standardDeviation: 0,
      zScore: 0,
      placementPoints: 0,
      dominanceScore: 0,
      sportScore: 0,
    };
  }

  return {
    rank: team.rank,
    fantasyPoints: team.fantasyPoints,
    leagueAverage: team.leagueAverage,
    standardDeviation: team.standardDeviation,
    zScore: team.zScore,
    placementPoints: team.placementPoints,
    dominanceScore: team.zScore * 10,
    sportScore: team.sportScore,
  };
};



  const standings: OverallRow[] =
    allOwners.map((owner) => {
      const NFL =
        getSportResult(owner, "NFL");

      const MLB =
        getSportResult(owner, "MLB");

      const NBA =
        getSportResult(owner, "NBA");

      const EPL =
        getSportResult(owner, "EPL");

      const PGA =
        getSportResult(owner, "PGA");

      const total =
        NFL.sportScore +
        MLB.sportScore +
        NBA.sportScore +
        EPL.sportScore +
        PGA.sportScore;

      return {
        owner,
        NFL,
        MLB,
        NBA,
        EPL,
        PGA,
        total,
      };
    });

  standings.sort(
    (a, b) => b.total - a.total
  );

  return standings;
}
