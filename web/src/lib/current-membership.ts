import settings from "../../data/league-settings.json";
// Apply current rules only to live snapshots. Never invent a missing owner's
// fantasy points or include them as zero in the dominance calculation.
export function currentLeague<T extends {standings:{team:string}[]}>(league:T){
  const names=settings.owners.map(o=>o.name);
  if(league.standings.some(row=>!names.includes(row.team))||new Set(league.standings.map(r=>r.team)).size!==league.standings.length)throw new Error("Fantrax snapshot does not match current membership");
  return {...league,placement_points:settings.placement_points.slice(0,league.standings.length)};
}
export function missingOwners(league:{standings:{team:string}[]}){
  return settings.owners.filter(o=>!league.standings.some(row=>row.team===o.name)).map(o=>o.name);
}
