import nba from "../../../../data/nba.json";
import SportStandings from "@/components/SportStandings";

export default function NBAPage() {
  return (
    <SportStandings
      title="NBA"
      league={nba}
    />
  );
}
