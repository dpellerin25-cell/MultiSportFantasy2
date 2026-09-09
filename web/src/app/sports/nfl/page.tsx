import nfl from "../../../../data/nfl.json";
import SportStandings from "@/components/SportStandings";

export default function NFLPage() {
  return (
    <SportStandings
      title="NFL"
      league={nfl}
    />
  );
}
