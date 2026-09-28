"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  commissionerCommand,
  type CommissionerAction,
  type DraftState,
  type Player,
} from "@/lib/draft-model";
const button =
  "min-h-11 rounded-lg bg-blue-800 px-3 py-2 font-semibold text-white disabled:opacity-40";
const field = "min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2";
type Command = ReturnType<typeof commissionerCommand>;
export default function CommissionerControls({
  state,
  client,
  fresh,
  onChanged,
}: {
  state: DraftState;
  client: SupabaseClient;
  fresh: boolean;
  onChanged: () => void;
}) {
  const [confirmation, setConfirmation] = useState<{
      command: Command;
      label: string;
    } | null>(null),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Player[]>([]),
    [chosen, setChosen] = useState<Player | null>(null),
    [searchError, setSearchError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null),
    lock = useRef(false);
  useEffect(() => {
    if (confirmation) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmation]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setSearchError("");
      client
        .rpc("draft_available_players", {
          target: state.draft_id,
          search_text: query,
          page_size: 20,
        })
        .then(({ data, error }) => {
          if (!alive) return;
          if (error) {
            setSearchError(error.message);
            setResults([]);
          } else setResults(data.players);
        });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [client, query, state.draft_id, state.revision]);
  if (!state.viewer_is_commissioner) return null;
  function prepare(
    action: CommissionerAction,
    args: Record<string, unknown>,
    label: string,
  ) {
    setMessage("");
    setAttempted(false);
    setConfirmation({
      command: commissionerCommand(state, action, args, crypto.randomUUID()),
      label,
    });
  }
  async function send() {
    if (
      !confirmation ||
      lock.current ||
      (!attempted &&
        (!fresh || state.revision !== confirmation.command.expected_revision))
    )
      return;
    lock.current = true;
    setBusy(true);
    setAttempted(true);
    try {
      const { error } = await client.rpc("draft_command", confirmation.command);
      if (error) {
        if (!error.code) {
          setMessage("Connection interrupted. Retry the same request safely.");
          return;
        }
        setMessage(error.message);
        setConfirmation(null);
        setAttempted(false);
        onChanged();
        return;
      }
      setMessage("Commissioner action saved.");
      setConfirmation(null);
      setAttempted(false);
      setChosen(null);
      onChanged();
    } catch {
      setMessage("Connection interrupted. Retry the same request safely.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const disabled = !fresh || busy || !!confirmation;
  const assignable = state.picks.filter(
    (p) =>
      !p.player_id &&
      (p.skipped_at || p.pick_number === state.current_pick_number),
  );
  return (
    <section className="rounded-2xl border border-blue-300 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">Commissioner Controls</h2>
      <p className="mt-2 text-sm text-slate-600">
        Every action is checked and recorded by the league database.
      </p>
      {message && (
        <p role="status" className="my-3 rounded-lg bg-blue-50 p-3 text-sm">
          {message}
        </p>
      )}
      <div className="my-4 flex flex-wrap gap-2">
        {state.status === "setup" && (
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              prepare(
                "start",
                {},
                "Start this test draft? This creates all pick slots and starts the first owner’s clock.",
              )
            }
          >
            Start draft
          </button>
        )}
        {state.status === "running" && (
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              prepare("pause", {}, "Pause the current draft clock?")
            }
          >
            Pause
          </button>
        )}
        {state.status === "paused" && (
          <button
            className={button}
            disabled={disabled}
            onClick={() =>
              prepare("resume", {}, "Resume with the saved time remaining?")
            }
          >
            Resume
          </button>
        )}
      </div>
      {["setup", "running", "paused", "awaiting_makeups"].includes(
        state.status,
      ) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const seconds = Number(
              new FormData(e.currentTarget).get("seconds"),
            );
            prepare(
              "set_timer",
              { seconds },
              `Set future pick timers to ${seconds} seconds? The current turn keeps its remaining time.`,
            );
          }}
        >
          <label className="block text-sm font-semibold">
            Future pick timer (seconds)
            <input
              key={state.timer_seconds}
              className={`${field} mt-1`}
              name="seconds"
              type="number"
              min={1}
              max={86400}
              defaultValue={state.timer_seconds}
              required
            />
          </label>
          <p className="my-2 text-xs text-slate-500">
            Changing this does not extend or shorten the current turn.
          </p>
          <button className={button} disabled={disabled}>
            Save timer
          </button>
        </form>
      )}
      {state.status === "setup" && (
        <details className="mt-5">
          <summary className="cursor-pointer py-2 font-semibold">
            Round-one owner order
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const owners = new FormData(e.currentTarget).getAll("owner");
              prepare(
                "set_order",
                { owners },
                "Save this round-one order? Snake rounds reverse it automatically.",
              );
            }}
          >
            <div key={state.revision} className="space-y-2">
              {state.participants.map((p, i) => (
                <label key={p.owner_id} className="block text-sm">
                  Pick {i + 1}
                  <select
                    name="owner"
                    className={field}
                    defaultValue={p.owner_id}
                  >
                    {state.participants.map((o) => (
                      <option key={o.owner_id} value={o.owner_id}>
                        {o.display_name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button className={`${button} mt-3`} disabled={disabled}>
              Save order
            </button>
          </form>
        </details>
      )}
      {["running", "paused", "awaiting_makeups"].includes(state.status) && (
        <details className="mt-5">
          <summary className="cursor-pointer py-2 font-semibold">
            Assign current or skipped pick
          </summary>
          <p className="mb-2 text-xs text-slate-500">
            Pause first when correcting picks to avoid timer changes during
            selection.
          </p>
          <label className="block text-sm">
            Search available player
            <input
              className={field}
              maxLength={100}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setChosen(null);
                setResults([]);
              }}
            />
          </label>
          {searchError && <p role="alert">{searchError}</p>}
          <ul className="max-h-56 overflow-auto">
            {results.map((p) => (
              <li key={p.player_id}>
                <button
                  type="button"
                  className={`min-h-11 w-full rounded-lg p-2 text-left text-sm ${chosen?.player_id === p.player_id ? "bg-blue-100" : "hover:bg-blue-50"}`}
                  onClick={() => setChosen(p)}
                >
                  {p.player_name} · {p.sport} · {p.position ?? "—"}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!chosen) return;
              const pick_id = String(new FormData(e.currentTarget).get("slot"));
              const slot = assignable.find((p) => p.pick_id === pick_id);
              if (!slot) return;
              prepare(
                "assign",
                { pick_id, player_id: chosen.player_id },
                `Assign ${chosen.player_name} to pick #${slot.pick_number} for ${state.participants.find((o) => o.owner_id === slot.owner_id)?.display_name}?`,
              );
            }}
          >
            <label className="mt-2 block text-sm">
              Unfilled pick
              <select className={field} name="slot" required>
                {assignable.map((p) => (
                  <option key={p.pick_id} value={p.pick_id}>
                    #{p.pick_number} ·{" "}
                    {
                      state.participants.find((o) => o.owner_id === p.owner_id)
                        ?.display_name
                    }
                    {p.skipped_at ? " · Skipped" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={`${button} mt-3`}
              disabled={disabled || !chosen || !assignable.length}
            >
              Review assignment
            </button>
          </form>
        </details>
      )}
      {["paused", "awaiting_makeups", "completed"].includes(state.status) && (
        <details className="mt-5">
          <summary className="cursor-pointer py-2 font-semibold">
            Undo latest selection
          </summary>
          <p className="mb-2 text-xs text-slate-500">
            Only the latest active selection can be undone. The database
            verifies this; pick number does not determine selection order. Undo
            reopens a makeup slot without rewinding the clock.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              prepare(
                "undo",
                {
                  selection_id: data.get("selection"),
                  reason: String(data.get("reason")).trim(),
                },
                "Undo this selection and release the player back to the pool?",
              );
            }}
          >
            <label className="block text-sm">
              Selection
              <select className={field} name="selection" required>
                {state.picks
                  .filter((p) => p.selection_id)
                  .map((p) => (
                    <option key={p.selection_id} value={p.selection_id!}>
                      #{p.pick_number} · {p.player_name} ·{" "}
                      {p.selected_at
                        ? new Date(p.selected_at).toLocaleString()
                        : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="mt-2 block text-sm">
              Reason
              <input name="reason" className={field} required maxLength={500} />
            </label>
            <button
              className={`${button} mt-3`}
              disabled={disabled || !state.picks.some((p) => p.selection_id)}
            >
              Review undo
            </button>
          </form>
        </details>
      )}
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          if (!attempted && !busy) setConfirmation(null);
        }}
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl p-6 text-slate-900 backdrop:bg-slate-950/60"
        aria-labelledby="commissioner-confirm"
      >
        <h3 id="commissioner-confirm" className="text-xl font-bold">
          Confirm commissioner action
        </h3>
        <p className="mt-3">{confirmation?.label}</p>
        {confirmation &&
          !attempted &&
          confirmation.command.expected_revision !== state.revision && (
            <p role="status" className="mt-3 text-amber-800">
              Draft changed. Cancel and review the latest state.
            </p>
          )}
        {message && (
          <p role="status" className="mt-3">
            {message}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            className="min-h-11 rounded-lg border px-3"
            disabled={busy || attempted}
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </button>
          <button
            className={button}
            disabled={
              busy ||
              (!attempted &&
                (!fresh ||
                  confirmation?.command.expected_revision !== state.revision))
            }
            onClick={send}
          >
            {busy ? "Saving…" : attempted ? "Retry same action" : "Confirm"}
          </button>
        </div>
      </dialog>
    </section>
  );
}
