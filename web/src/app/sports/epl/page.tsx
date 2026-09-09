import premierLeague from "../../../../data/premier-league.json";
import SportStandings from "@/components/SportStandings";

export default function EPLPage() {
  return (
    <SportStandings
      title="Premier League"
      league={premierLeague}
    />
  );
}
