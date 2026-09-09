import pga from "../../../../data/pga.json";
import SportStandings from "@/components/SportStandings";

export default function PGAPage() {
  return (
    <SportStandings
      title="PGA"
      league={pga}
    />
  );
}
