"use client";
import { useEffect, useRef, useState } from "react";
import {
  createClient,
  type SupabaseClient,
  type Session,
} from "@supabase/supabase-js";
import {
  currentPick,
  draftConfig,
  mayPick,
  pickCommand,
  type DraftState,
  type Player,
  type PickCommand,
} from "@/lib/draft-model";

import DraftViews from "./DraftViews";
import CommissionerControls from "./CommissionerControls";

const config = draftConfig(
  process.env.NEXT_PUBLIC_DRAFT_SUPABASE_URL,
  process.env.NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY,
  process.env.NEXT_PUBLIC_DRAFT_ID,
);
const panel = "rounded-2xl border border-blue-100 bg-white p-5 shadow-sm";
const button =
  "min-h-11 rounded-lg bg-blue-800 px-4 py-2 font-semibold text-white hover:bg-blue-900 disabled:cursor-not-allowed disabled:opacity-40";
const field =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2";
function message(e: unknown) {
  return e && typeof e === "object" && "message" in e
    ? String(e.message)
    : "Unable to connect. Please try again.";
}
function Confirmation({
  children,
  className,
  onCancel,
}: {
  children: React.ReactNode;
  className: string;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      className={className}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {children}
    </dialog>
  );
}

export default function DraftRoom() {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  useEffect(() => {
    if (!config) return;
    const c = createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "multisport-draft-test-auth",
      },
    });
    let alive = true;
    c.auth.getSession().then(({ data, error }) => {
      if (alive) {
        setClient(c);
        setSession(data.session);
        setReady(true);
        if (error) setAuthError(error.message);
      }
    });
    const { data } = c.auth.onAuthStateChange((_event, s) => {
      if (alive) {
        setSession(s);
        setReady(true);
      }
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
      void c.removeAllChannels();
    };
  }, []);
  if (!config)
    return (
      <section className={panel}>
        <h2 className="text-xl font-bold">Draft room not configured</h2>
        <p className="mt-2 text-slate-600">
          The test draft connection hasn’t been enabled for this website yet.
          Your league standings are still available.
        </p>
      </section>
    );
  if (!ready || !client)
    return (
      <p role="status" className={panel}>
        Checking your sign-in…
      </p>
    );
  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setAuthBusy(true);
    setAuthError("");
    const form = new FormData(event.currentTarget);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
      });
      if (error) setAuthError(error.message);
    } catch (e) {
      setAuthError(message(e));
    } finally {
      setAuthBusy(false);
    }
  }
  async function signOut() {
    if (!client) return;
    setAuthBusy(true);
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) setAuthError(error.message);
    setAuthBusy(false);
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800">
          Test league · Rehearsal
        </span>
        {session && (
          <button
            className="min-h-11 rounded-lg border border-blue-200 bg-white px-4 font-semibold text-blue-800"
            disabled={authBusy}
            onClick={signOut}
          >
            Sign out
          </button>
        )}
      </div>
      {authError && (
        <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">
          {authError}
        </p>
      )}
      {!session ? (
        <section className={`${panel} mx-auto max-w-md`}>
          <h2 className="text-xl font-bold">Owner sign-in</h2>
          <p className="mt-2 text-sm text-slate-600">
            Use the account linked to your league owner. Contact Doug if you
            need access.
          </p>
          <form onSubmit={signIn} className="mt-5 space-y-4">
            <label className="block text-sm font-semibold">
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                className={`${field} mt-1`}
              />
            </label>
            <label className="block text-sm font-semibold">
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={`${field} mt-1`}
              />
            </label>
            <button disabled={authBusy} className={`${button} w-full`}>
              {authBusy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      ) : (
        <AuthenticatedRoom
          key={session.user.id}
          client={client}
          target={config.target}
        />
      )}
    </>
  );
}

function AuthenticatedRoom({
  client,
  target,
}: {
  client: SupabaseClient;
  target: string;
}) {
  const [state, setState] = useState<DraftState | null>(null),
    [error, setError] = useState(""),
    [connection, setConnection] = useState("Connecting"),
    [fresh, setFresh] = useState(false);
  const [clock, setClock] = useState(0),
    anchor = useRef({ server: 0, local: 0 });
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [sport, setSport] = useState("");
  const [players, setPlayers] = useState<Player[]>([]),
    [position, setPosition] = useState(""),
    [positions, setPositions] = useState<string[]>([]),
    [rankingSnapshot, setRankingSnapshot] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [playerError, setPlayerError] = useState("");
  const [selected, setSelected] = useState<Player | null>(null),
    [planned, setPlanned] = useState<PickCommand | null>(null),
    [pending, setPending] = useState<PickCommand | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const refresh = useRef<() => void>(() => {}),
    submitting = useRef(false);
  useEffect(() => {
    let alive = true,
      running = false,
      dirty = false;
    async function load() {
      dirty = true;
      if (running) return;
      running = true;
      try {
        while (dirty && alive) {
          dirty = false;
          const { data, error } = await client.rpc("draft_state", { target });
          if (!alive) return;
          if (error) throw error;
          const s = data as DraftState;
          anchor.current = {
            server: Date.parse(s.server_time),
            local: performance.now(),
          };
          setClock(anchor.current.server);
          setState(s);
          setFresh(true);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setFresh(false);
          setState(null);
          setPlayers([]);
          setError(message(e));
        }
      } finally {
        running = false;
      }
    }
    refresh.current = () => void load();
    void load();
    const ch = client
      .channel(`draft-ui:${target}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "draft",
          table: "live_updates",
          filter: `draft_id=eq.${target}`,
        },
        () => {
          setCursor(null);
          void load();
        },
      )
      .subscribe((status) => {
        if (!alive) return;
        setConnection(
          status === "SUBSCRIBED" ? "Live" : "Reconnecting · periodic refresh",
        );
        if (status === "SUBSCRIBED") void load();
        else setFresh(false);
      });
    const poll = setInterval(() => void load(), 15000),
      timer = setInterval(
        () =>
          setClock(
            anchor.current.server + performance.now() - anchor.current.local,
          ),
        250,
      );
    const focus = () => void load();
    window.addEventListener("focus", focus);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      void client.removeChannel(ch);
    };
  }, [client, target]);
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query);
      setCursor(null);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);
  const revision = state?.revision;
  useEffect(() => {
    if (revision === undefined) return;
    let alive = true;
    // Schedule the loading state together with the external request; cancel old
    // filter/revision responses so they cannot repopulate an obsolete page.
    const start = setTimeout(() => {
      setLoading(true);
      setPlayerError("");
      setPlayers([]);
      client
        .rpc("draft_available_players", {
          target,
          sport_filter: sport || null,
          search_text: search,
          after_player: cursor,
          page_size: 30,
          position_filter: position || null,
        })
        .then(({ data, error }) => {
          if (!alive) return;
          setLoading(false);
          if (error) {
            setPlayerError(error.message);
            setNext(null);
            return;
          }
          if (data.revision !== revision) {
            refresh.current();
            return;
          }
          setPlayers(data.players);
          setPositions(data.available_positions ?? []);
          setRankingSnapshot(data.ranking_snapshot ?? null);
          setNext(data.next_cursor);
        });
    }, 0);
    return () => {
      alive = false;
      clearTimeout(start);
    };
  }, [client, target, sport, search, cursor, revision, position]);
  const pick = state ? currentPick(state) : undefined,
    owner = state?.participants.find((p) => p.owner_id === pick?.owner_id),
    viewer = state?.participants.find(
      (p) => p.owner_id === state.viewer_owner_id,
    );
  const allowed = !!state && fresh && mayPick(state, clock);
  const seconds =
    state?.status === "paused"
      ? Math.ceil(state.paused_remaining_seconds ?? 0)
      : state?.deadline_at
        ? Math.max(0, Math.ceil((Date.parse(state.deadline_at) - clock) / 1000))
        : null;
  async function submit() {
    if (!state || !selected || !planned || submitting.current) return;
    if (!pending && (!allowed || planned.expected_revision !== state.revision))
      return;
    const cmd = pending ?? planned;
    submitting.current = true;
    setBusy(true);
    setPending(cmd);
    setNotice("");
    try {
      const { error } = await client.rpc("draft_command", cmd);
      if (error) {
        // A transport failure has an uncertain outcome: preserve exact idempotency
        // envelope until explicitly retried, even if the visible turn has advanced.
        if (!error.code) {
          setNotice(
            "Connection interrupted. Retry this same pick to safely check its result.",
          );
          return;
        }
        setPending(null);
        setSelected(null);
        setNotice(error.message);
        refresh.current();
        return;
      }
      setPending(null);
      setSelected(null);
      setNotice("Pick saved.");
      setCursor(null);
      refresh.current();
    } catch {
      setNotice(
        "Connection interrupted. Retry this same pick to safely check its result.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-4 text-red-800"
        >
          {error}
          <p className="mt-1 text-sm">
            Access is checked by the league database. If your account isn’t
            linked, contact Doug.
          </p>
          <button className="mt-2 underline" onClick={() => refresh.current()}>
            Try again
          </button>
        </div>
      )}
      {!state && !error && (
        <p role="status" className={panel}>
          Loading your draft…
        </p>
      )}
      {state && (
        <>
          <div className="mb-4 flex flex-wrap justify-between gap-2 text-sm">
            <p>
              Signed in as{" "}
              <strong>{viewer?.display_name ?? "Commissioner"}</strong>
            </p>
            <p className="text-slate-600" role="status">
              {connection}
            </p>
          </div>
          <section
            aria-labelledby="clock-title"
            className="mb-4 rounded-2xl bg-blue-900 p-4 text-white shadow-sm"
          >
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wider text-blue-200">
                  On the Clock · {state.status.replaceAll("_", " ")}
                </p>
                <h2 id="clock-title" className="mt-2 text-2xl font-bold">
                  {state.name}
                </h2>
                <p className="mt-3 text-lg">
                  {state.status === "setup"
                    ? "Waiting for the commissioner to start"
                    : (owner?.display_name ?? "No owner on the clock")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-blue-200">
                  {state.status === "paused"
                    ? "Time remaining · Paused"
                    : "Time remaining"}
                </p>
                <p className="mt-1 font-mono text-4xl font-bold tabular-nums">
                  {seconds === null
                    ? "—"
                    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t border-blue-700 pt-2 text-sm">
              <span>
                Round <strong>{pick?.round ?? "—"}</strong> / {state.rounds}
              </span>
              <span>
                Overall pick <strong>{state.current_pick_number ?? "—"}</strong>
              </span>
              <span>
                {allowed
                  ? "Your turn — choose a player"
                  : state.status === "running" && seconds === 0
                    ? "Deadline reached — waiting for the league timer"
                    : state.status === "paused"
                      ? "Draft paused"
                      : "Selections open only on your turn"}
              </span>
            </div>
          </section>
          {notice && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-blue-200 bg-white p-3"
            >
              {notice}
            </p>
          )}
          <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)]">
            <DraftViews
              state={state}
              availablePlayers={
                <section
                  className={`${panel} xl:absolute xl:inset-0 xl:overflow-y-auto`}
                  aria-labelledby="players-title"
                >
                  <h2 id="players-title" className="text-xl font-bold">
                    Available Players
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Search the saved league pool. Free agents and waiver players
                    are eligible.
                  </p>
                  {rankingSnapshot ? (
                    <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
                      Fixed rankings · {rankingSnapshot}. Ranked players first,
                      unranked players last.
                      {sport === "PGA"
                        ? " PGA uses 2026 earnings."
                        : sport === "EPL"
                          ? " EPL uses 2026/27 FPL ranks."
                          : !sport
                            ? " All sports sorts by sport rank, then sport; ranks are not comparable values across sports."
                            : " Dynasty rankings."}
                    </p>
                  ) : (
                    !loading &&
                    !playerError && (
                      <p className="mt-2 text-xs text-amber-800">
                        Ranked sorting will be available after the ranking
                        snapshot database migration is installed.
                      </p>
                    )
                  )}
                  <label className="mt-4 block text-sm font-semibold">
                    Player name
                    <input
                      className={`${field} mt-1`}
                      placeholder="Search players…"
                      maxLength={100}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <div
                    aria-label="Filter by sport"
                    className="my-4 flex flex-wrap gap-2"
                  >
                    {["", "NFL", "MLB", "NBA", "EPL", "PGA"].map((s) => (
                      <button
                        key={s}
                        aria-pressed={sport === s}
                        onClick={() => {
                          setSport(s);
                          setPosition("");
                          setPositions([]);
                          setCursor(null);
                        }}
                        className={`min-h-10 rounded-lg px-3 text-sm font-semibold ${sport === s ? "bg-blue-800 text-white" : "bg-blue-50 text-blue-800"}`}
                      >
                        {s || "All"}
                      </button>
                    ))}
                  </div>
                  <label className="mb-3 block text-sm font-semibold">
                    Position
                    <select
                      className={`${field} mt-1`}
                      value={position}
                      onChange={(e) => {
                        setPosition(e.target.value);
                        setCursor(null);
                      }}
                    >
                      <option value="">All positions</option>
                      {position && !positions.includes(position) && (
                        <option value={position}>{position}</option>
                      )}
                      {positions.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  {playerError && (
                    <p role="alert" className="text-red-700">
                      {playerError}
                    </p>
                  )}
                  {loading ? (
                    <p role="status" className="py-8 text-slate-500">
                      Loading players…
                    </p>
                  ) : players.length === 0 ? (
                    <p className="py-8 text-slate-500">
                      No available players match your search.
                    </p>
                  ) : (
                    <ul className="divide-y divide-blue-100">
                      {players.map((p) => (
                        <li
                          key={p.player_id}
                          className="flex items-center justify-between gap-3 py-3"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold">{p.player_name}</p>
                            {rankingSnapshot && (
                              <p className="text-xs font-semibold text-blue-800">
                                {p.source_rank == null
                                  ? "Unranked / unmatched"
                                  : `${p.sport} rank #${p.source_rank}`}
                              </p>
                            )}
                            <p className="mt-1 text-sm text-slate-600">
                              {[p.sport, p.position, p.professional_team]
                                .filter(Boolean)
                                .join(" · ")}{" "}
                              <span className="text-slate-400">
                                ·{" "}
                                {p.availability_status === "waivers"
                                  ? "Waivers"
                                  : "Free agent"}
                              </span>
                            </p>
                          </div>
                          <button
                            className={button}
                            disabled={!allowed || busy || !!pending}
                            onClick={() => {
                              setSelected(p);
                              setPlanned(
                                pickCommand(state, p, crypto.randomUUID()),
                              );
                              setNotice("");
                            }}
                          >
                            Select
                            <span className="sr-only"> {p.player_name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-4 flex justify-between gap-3">
                    <button
                      disabled={!cursor || loading}
                      className="min-h-11 px-2 text-sm font-semibold text-blue-800 disabled:opacity-40"
                      onClick={() => setCursor(null)}
                    >
                      Back to first page
                    </button>
                    <button
                      disabled={!next || loading}
                      className="min-h-11 px-2 text-sm font-semibold text-blue-800 disabled:opacity-40"
                      onClick={() => setCursor(next)}
                    >
                      Next players →
                    </button>
                  </div>
                </section>
              }
            />

            <aside className="space-y-5 xl:col-span-3">
              <CommissionerControls
                state={state}
                client={client}
                fresh={fresh}
                onChanged={() => {
                  setCursor(null);
                  refresh.current();
                }}
              />
            </aside>
          </div>
        </>
      )}
      {selected && (
        <Confirmation
          onCancel={() => {
            if (!busy && !pending) setSelected(null);
          }}
          className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none items-center justify-center bg-slate-950/60 p-4"
        >
          <section className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="confirm-title" className="text-xl font-bold">
              Confirm your pick
            </h2>
            <p className="mt-3">
              Draft <strong>{selected.player_name}</strong>?
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {selected.sport} · {selected.position ?? "Position not listed"}
            </p>
            {!pending && planned?.expected_revision !== state?.revision && (
              <p role="status" className="mt-3 text-sm text-amber-800">
                The draft changed. Cancel and review the current turn before
                choosing again.
              </p>
            )}
            {pending && (
              <p className="mt-3 text-sm text-blue-800">
                A retry sends the same request, so it cannot create a second
                pick.
              </p>
            )}
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="min-h-11 rounded-lg border px-4"
                disabled={busy || !!pending}
                onClick={() => setSelected(null)}
              >
                Cancel
              </button>
              <button
                autoFocus
                className={button}
                disabled={
                  busy ||
                  (!pending &&
                    (!allowed ||
                      planned?.expected_revision !== state?.revision))
                }
                onClick={submit}
              >
                {busy
                  ? "Saving…"
                  : pending
                    ? "Retry same pick"
                    : "Confirm pick"}
              </button>
            </div>
            {notice && (
              <p role="status" className="mt-3 text-sm">
                {notice}
              </p>
            )}
          </section>
        </Confirmation>
      )}
    </>
  );
}
