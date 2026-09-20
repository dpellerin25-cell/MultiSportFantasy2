import nfl from "../../data/rosters/nfl.json";
import mlb from "../../data/rosters/mlb.json";
import nba from "../../data/rosters/nba.json";
import epl from "../../data/rosters/premier-league.json";
import pga from "../../data/rosters/pga.json";

const rosters = { NFL: nfl, MLB: mlb, NBA: nba, EPL: epl, PGA: pga };

export function getOwnerRosterCounts(owner: string) {
  const count = (sport: keyof typeof rosters) =>
    rosters[sport].rosters
      .filter((roster) => roster.owner === owner)
      .reduce((total, roster) => total + roster.players.length, 0);

  return {
    NFL: count("NFL"),
    MLB: count("MLB"),
    NBA: count("NBA"),
    EPL: count("EPL"),
    PGA: count("PGA"),
  };
}
