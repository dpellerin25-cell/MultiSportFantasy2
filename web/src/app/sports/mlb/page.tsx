import mlb from "../../../../data/mlb.json";
import SportStandings from "@/components/SportStandings";

export default function MLBPage() {
  return (
    <SportStandings
      title="MLB"
      league={mlb}
    />
  );
}
