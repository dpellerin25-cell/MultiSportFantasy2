import type { Pick } from "./draft-model";

export function playerPositions(position: string | null) {
  return (position ?? "")
    .toUpperCase()
    .split(/[,/;\s]+/)
    .filter(Boolean);
}
type Slot = { label: string; eligible: string[] };
const slots = (count: number, label: string, eligible: string[]): Slot[] =>
  Array.from({ length: count }, () => ({ label, eligible }));
const bats = [
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "IF",
  "OF",
  "LF",
  "CF",
  "RF",
  "DH",
  "UT",
  "UTIL",
];
const basketball = ["PG", "SG", "G", "SF", "PF", "F", "C"];
export const STARTING_SLOTS: Record<string, Slot[]> = {
  NFL: [
    ...slots(1, "QB", ["QB"]),
    ...slots(2, "RB", ["RB"]),
    ...slots(2, "WR", ["WR"]),
    ...slots(1, "TE", ["TE"]),
    ...slots(2, "FLEX", ["RB", "WR", "TE"]),
    ...slots(1, "Superflex", ["QB", "RB", "WR", "TE"]),
  ],
  NBA: [
    ...slots(2, "G", ["PG", "SG", "G"]),
    ...slots(2, "F/C", ["SF", "PF", "F", "C"]),
    ...slots(4, "FLEX", basketball),
  ],
  MLB: [
    ...slots(4, "IF", ["C", "1B", "2B", "3B", "SS", "IF"]),
    ...slots(3, "OF", ["OF", "LF", "CF", "RF"]),
    ...slots(2, "FLEX", bats),
    ...slots(5, "P", ["SP", "RP", "P"]),
  ],
  EPL: [
    ...slots(1, "GK", ["GK"]),
    ...slots(3, "D", ["D", "DF", "DEF"]),
    ...slots(3, "M", ["M", "MF", "MID"]),
    ...slots(2, "F", ["F", "FW", "FWD"]),
    ...slots(2, "FLEX", ["D", "DF", "DEF", "M", "MF", "MID", "F", "FW", "FWD"]),
  ],
  PGA: slots(6, "Golfer", []),
};

// Bipartite matching fills as many legal slots as possible without using a
// multi-position player twice. Earlier draft picks get first consideration.
export function proposedLineup(roster: Pick[], sport: string) {
  const players = roster
    .filter((p) => p.player_id && p.sport === sport)
    .sort((a, b) => a.pick_number - b.pick_number);
  const definitions = STARTING_SLOTS[sport] ?? [];
  const assigned = Array<number>(definitions.length).fill(-1);
  function fit(player: number, visited: Set<number>): boolean {
    const eligible = definitions
      .map((slot, i) => ({ slot, i }))
      .filter(
        ({ slot }) =>
          sport === "PGA" ||
          playerPositions(players[player].position).some((p) =>
            slot.eligible.includes(p),
          ),
      );
    // Prefer an empty legal slot before moving an earlier drafted starter.
    for (const { i } of eligible)
      if (!visited.has(i) && assigned[i] === -1) {
        visited.add(i);
        assigned[i] = player;
        return true;
      }
    for (const { i } of eligible) {
      if (visited.has(i)) continue;
      visited.add(i);
      if (fit(assigned[i], visited)) {
        assigned[i] = player;
        return true;
      }
    }
    return false;
  }
  players.forEach((_, i) => fit(i, new Set()));
  const used = new Set(assigned);
  return {
    slots: definitions.map((slot, i) => ({
      label: slot.label,
      player: assigned[i] < 0 ? null : players[assigned[i]],
    })),
    bench: players.filter((_, i) => !used.has(i)),
  };
}
