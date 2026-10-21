// Never use the latest sport snapshot for a different or not-yet-started Cup.
export function belongsToLiveChampionship(status: string, year: number, snapshotYear?: number) {
  return status === "live" && snapshotYear === year;
}

export function emptySeasonSnapshot(sport: string) {
  return {sport, standings: [], placement_points: []};
}
