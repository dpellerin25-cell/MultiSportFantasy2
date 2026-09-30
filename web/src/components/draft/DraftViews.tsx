"use client";
import { useState } from "react";
import { rosterProgress, type DraftState } from "@/lib/draft-model";
import { proposedLineup, STARTING_SLOTS } from "@/lib/draft-lineups";
const box =
  "min-w-0 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm";
export default function DraftViews({
  state,
  availablePlayers,
}: {
  state: DraftState;
  availablePlayers: React.ReactNode;
}) {
  const [round, setRound] = useState("current"),
    [lineupSport, setLineupSport] = useState("NFL"),
    [chosenOwner, setOwner] = useState("");
  const current =
    state.picks.find((p) => p.pick_number === state.current_pick_number)
      ?.round ?? 1;
  const shown = round === "current" ? current : Number(round);
  const visiblePicks = state.picks.filter(
    (p) => round === "all" || p.round === shown,
  );
  const owner =
    chosenOwner ||
    state.viewer_owner_id ||
    state.participants[0]?.owner_id ||
    "";
  const roster = state.picks.filter((p) => p.owner_id === owner && p.player_id);
  const lineup = proposedLineup(roster, lineupSport);
  const ownerName =
    state.participants.find((p) => p.owner_id === owner)?.display_name ??
    "Owner";
  return (
    <>
      <section className={`${box} ${round === "all" ? "xl:max-h-[80vh] xl:overflow-y-auto" : ""}`} aria-labelledby="board-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="board-title" className="text-xl font-bold">
            Draft Board
          </h2>
          <label className="text-sm">
            Round{" "}
            <select
              className="ml-2 min-h-11 rounded-lg border px-2"
              value={round}
              onChange={(e) => setRound(e.target.value)}
            >
              <option value="current">Current</option>
              <option value="all">All rounds</option>
              {Array.from({ length: state.rounds }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          {state.picks.filter((p) => p.player_id).length} selections recorded ·
          {round === "all" ? "All rounds" : `Round ${shown}`}
        </p>
        {!!state.picks.length && !visiblePicks.length && (
          <p className="py-4 text-sm text-slate-500">
            No selections match these filters.
          </p>
        )}
        {!state.picks.length ? (
          <p className="py-6 text-slate-500">
            Pick slots appear when the commissioner starts the draft.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-blue-100">
            {visiblePicks.map((p) => (
              <li
                key={p.pick_id}
                className={`rounded-lg p-3 ${p.pick_number === state.current_pick_number ? "bg-blue-50 ring-1 ring-blue-300" : ""}`}
              >
                <div className="flex justify-between gap-2">
                  <strong>
                    #{p.pick_number} ·{" "}
                    {
                      state.participants.find((o) => o.owner_id === p.owner_id)
                        ?.display_name
                    }
                  </strong>
                  <span className="text-xs text-slate-500">
                    {p.pick_number === state.current_pick_number
                      ? "On the clock"
                      : ""}
                  </span>
                </div>
                <p className="mt-1 text-sm">
                  {p.player_name ??
                    (p.skipped_at
                      ? "Skipped · awaiting commissioner assignment"
                      : "Not selected")}
                  {p.player_id && (
                    <span className="text-slate-500">
                      {" "}
                      ·{" "}
                      {[p.sport, p.position, p.professional_team]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="min-w-0 xl:relative">{availablePlayers}</div>
      <div className="min-w-0 xl:relative">
      <section className={`${box} xl:absolute xl:inset-0 xl:overflow-y-auto`} aria-labelledby="roster-title">
        <h2 id="roster-title" className="text-xl font-bold">
          {owner === state.viewer_owner_id
            ? "My Roster"
            : `${ownerName}’s Roster`}
        </h2>
        <label className="mt-3 block text-sm font-semibold">
          View owner’s roster
          <select
            className="mt-1 min-h-11 w-full rounded-lg border px-3"
            value={owner ?? ""}
            onChange={(e) => setOwner(e.target.value)}
          >
            {state.participants.map((o) => (
              <option key={o.owner_id} value={o.owner_id}>
                {o.display_name}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 text-sm text-slate-600">
          {roster.length} players selected. Viewing another roster does not
          change your signed-in identity.
        </p>
        <details className="mt-3">
          <summary className="cursor-pointer py-2 text-sm font-semibold">
            Sport minimum progress
          </summary>
          <div className="my-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rosterProgress(state, owner).map((r) => (
              <div
                key={r.sport}
                className={`rounded-lg p-3 ${r.count >= r.minimum ? "bg-emerald-50" : "bg-blue-50"}`}
              >
                <p className="text-sm font-semibold">{r.sport}</p>
                <p className="text-lg font-bold">
                  {r.count}{" "}
                  <span className="text-xs font-normal text-slate-600">
                    / {r.minimum} minimum
                  </span>
                </p>
                <progress
                  className="h-2 w-full accent-blue-800"
                  aria-label={`${r.sport} minimum progress`}
                  max={Math.max(r.minimum, 1)}
                  value={Math.min(r.count, r.minimum)}
                />
                <p className="text-xs text-slate-500">
                  {Math.max(0, r.minimum - r.count)} still needed
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Minimums are requirements, not roster limits. No sport maximums are
            configured.
          </p>
        </details>
        <h3 className="mt-3 font-bold">Proposed starting lineup</h3>
        <label className="mt-2 block text-sm">
          Sport
          <select
            className="ml-2 min-h-11 rounded-lg border px-2"
            value={lineupSport}
            onChange={(e) => setLineupSport(e.target.value)}
          >
            {Object.keys(STARTING_SLOTS).map((s) => (
              <option key={s} value={s}>
                {s === "EPL" ? "Premier League" : s}
              </option>
            ))}
          </select>
        </label>
        <p className="my-2 text-xs text-slate-500">
          Suggested from draft order and position eligibility, not player
          rankings. This does not set a Fantrax lineup.
        </p>
        <ul className="divide-y divide-blue-100">
          {lineup.slots.map((slot, i) => (
            <li key={i} className="flex gap-3 py-2 text-sm">
              <span className="w-20 shrink-0 font-semibold text-blue-800">
                {slot.label}
              </span>
              <span>
                {slot.player ? (
                  <>
                    {slot.player.player_name}
                    <span className="block text-xs text-slate-500">
                      {[slot.player.position, slot.player.professional_team]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-400">Open slot</span>
                )}
              </span>
            </li>
          ))}
        </ul>
        <h4 className="mt-3 text-sm font-semibold">
          Bench / unassigned ({lineup.bench.length})
        </h4>
        <ul className="text-sm">
          {lineup.bench.map((p) => (
            <li key={p.pick_id} className="py-1">
              {p.player_name} · {p.position || "Position not listed"}
            </li>
          ))}
        </ul>
        <details className="mt-4">
          <summary className="cursor-pointer py-2 font-semibold">
            All drafted players ({roster.length})
          </summary>
          <ul className="mt-3 divide-y divide-blue-100">
            {roster.map((p) => (
              <li className="py-3" key={p.pick_id}>
                <strong>{p.player_name}</strong>
                <p className="text-sm text-slate-500">
                  {[p.sport, p.position, p.professional_team]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  · Pick #{p.pick_number}
                </p>
              </li>
            ))}
          </ul>
        </details>
        {!roster.length && (
          <p className="py-5 text-slate-500">No players drafted yet.</p>
        )}
      </section>
      </div>
    </>
  );
}
