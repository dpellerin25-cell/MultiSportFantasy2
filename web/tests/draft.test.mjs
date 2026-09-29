import test from "node:test";
import {
  proposedLineup,
  STARTING_SLOTS,
  playerPositions,
} from "../src/lib/draft-lineups.ts";
test("starting lineup counts and flexible eligibility preserve unique assignments", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(STARTING_SLOTS).map(([s, v]) => [s, v.length]),
    ),
    { NFL: 9, NBA: 8, MLB: 14, EPL: 11, PGA: 6 },
  );
  const player = (id, sport, position, pick_number) => ({
    player_id: id,
    pick_id: id,
    player_name: id,
    sport,
    position,
    pick_number,
  });
  const nba = proposedLineup(
    [
      player("multi", "NBA", "G/F", 1),
      player("guard", "NBA", "G", 2),
      player("guard2", "NBA", "PG", 3),
    ],
    "NBA",
  );
  assert.equal(nba.slots.filter((s) => s.player).length, 3);
  assert.equal(
    new Set(nba.slots.filter((s) => s.player).map((s) => s.player.player_id))
      .size,
    3,
  );
  const mlb = proposedLineup(
    [player("catcher", "MLB", "C", 1), player("pitcher", "MLB", "SP/RP", 2)],
    "MLB",
  );
  assert.equal(
    mlb.slots.find((s) => s.player?.player_id === "catcher").label,
    "IF",
  );
  assert.equal(
    mlb.slots.find((s) => s.player?.player_id === "pitcher").label,
    "P",
  );
  const pga = proposedLineup(
    Array.from({ length: 7 }, (_, i) => player(String(i), "PGA", null, i)),
    "PGA",
  );
  assert.equal(pga.slots.filter((s) => s.player).length, 6);
  assert.equal(pga.bench.length, 1);
  assert.deepEqual(playerPositions(" SP / RP "), ["SP", "RP"]);
  const unknown = proposedLineup([player("unknown", "NFL", null, 1)], "NFL");
  assert.equal(unknown.bench.length, 1);
});
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import {
  draftConfig,
  mayPick,
  pickCommand,
  commissionerCommand,
  rosterProgress,
} from "../src/lib/draft-model.ts";
const target = "4f7c9484-bc03-46cf-ae5f-8a0781061844";
const url = "https://tgvuntuhdqucazpoxrrg.supabase.co";
test("commissioner requests preserve revision and identity remains server-controlled", () => {
  assert.throws(() =>
    commissionerCommand(
      { viewer_is_commissioner: false },
      "start",
      {},
      "request",
    ),
  );
  const original = {
    draft_id: "draft",
    revision: 8,
    viewer_is_commissioner: true,
  };
  for (const action of [
    "start",
    "pause",
    "resume",
    "set_timer",
    "set_order",
    "assign",
    "undo",
  ]) {
    const command = commissionerCommand(
      original,
      action,
      { fixture: "value" },
      "request",
    );
    assert.deepEqual(command, {
      target: "draft",
      expected_revision: 8,
      request_id: "request",
      action,
      args: { fixture: "value" },
    });
    original.revision = 9;
    assert.equal(command.expected_revision, 8);
    original.revision = 8;
  }
});
test("roster progress counts only selected players for the receiving owner, without imposing maximums", () => {
  const result = rosterProgress(
    {
      rules: [
        { sport: "NFL", minimum: 1, maximum: null },
        { sport: "NBA", minimum: 8, maximum: null },
      ],
      picks: [
        { owner_id: "a", player_id: "one", sport: "NFL" },
        { owner_id: "a", player_id: "two", sport: "NFL" },
        { owner_id: "a", player_id: null, sport: "NBA", skipped_at: "fixture" },
        { owner_id: "b", player_id: "three", sport: "NBA" },
      ],
    },
    "a",
  );
  assert.deepEqual(
    result.map((r) => [r.sport, r.count, r.minimum, r.maximum]),
    [
      ["NFL", 2, 1, null],
      ["NBA", 0, 8, null],
    ],
  );
});
const state = {
  draft_id: target,
  status: "running",
  revision: 7,
  viewer_owner_id: "owner-a",
  current_pick_number: 1,
  deadline_at: "2026-09-28T12:01:00Z",
  picks: [{ pick_id: "slot-a", pick_number: 1, owner_id: "owner-a" }],
};
test("test-only public configuration rejects absent, secret and production settings", () => {
  assert.equal(draftConfig(), null);
  assert.equal(draftConfig(url, "sb_secret_do-not-use", target), null);
  assert.equal(
    draftConfig(
      "https://production.supabase.co",
      "sb_publishable_fixture",
      target,
    ),
    null,
  );
  assert.ok(draftConfig(url, "sb_publishable_fixture", target));
});
test("pick affordance follows server status, mapped owner and deadline", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  assert.equal(mayPick(state, now), true);
  for (const patch of [
    { status: "paused" },
    { status: "setup" },
    { viewer_owner_id: "other" },
    { viewer_owner_id: null },
    { deadline_at: null },
  ])
    assert.equal(mayPick({ ...state, ...patch }, now), false);
  assert.equal(mayPick(state, Date.parse(state.deadline_at)), false);
});
test("pick request freezes original revision/slot; never supplies an acting owner", () => {
  const cmd = pickCommand(state, { player_id: "player-a" }, "request-a");
  assert.deepEqual(cmd, {
    target,
    request_id: "request-a",
    expected_revision: 7,
    action: "pick",
    args: { pick_id: "slot-a", player_id: "player-a" },
  });
  assert.throws(() =>
    pickCommand({ ...state, picks: [] }, { player_id: "x" }, "r"),
  );
});
test("Supabase sign-in supplies user JWT to RPC, retry keeps exact envelope, sign-out clears session", async () => {
  const token = [
    "eyJhbGciOiJIUzI1NiJ9",
    Buffer.from(
      JSON.stringify({
        sub: "user-a",
        role: "authenticated",
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString("base64url"),
    "fixture",
  ].join(".");
  const calls = [];
  const client = createClient(url, "sb_publishable_fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const path = String(input);
        calls.push({
          path,
          headers: new Headers(init.headers),
          body: init.body,
        });
        if (path.includes("/token"))
          return Response.json({
            access_token: token,
            refresh_token: "fixture",
            expires_in: 3600,
            token_type: "bearer",
            user: {
              id: "user-a",
              aud: "authenticated",
              email: "fixture@example.invalid",
            },
          });
        if (path.includes("/logout"))
          return new Response(null, { status: 204 });
        if (path.includes("/rpc/draft_command"))
          return Response.json({ revision: 8, status: "running" });
        throw new Error("Unexpected request");
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: "fixture@example.invalid",
    password: "fixture-only",
  });
  assert.equal(error, null);
  const cmd = pickCommand(state, { player_id: "player-a" }, "request-a");
  await client.rpc("draft_command", cmd);
  await client.rpc("draft_command", cmd);
  const picks = calls.filter((c) => c.path.includes("/rpc/"));
  assert.equal(picks.length, 2);
  assert.equal(picks[0].headers.get("authorization"), `Bearer ${token}`);
  assert.equal(picks[0].body, picks[1].body);
  assert.equal(JSON.parse(picks[0].body).args.owner_id, undefined);
  await client.auth.signOut({ scope: "local" });
  assert.equal((await client.auth.getSession()).data.session, null);
});
