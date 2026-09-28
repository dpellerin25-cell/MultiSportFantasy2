import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { draftConfig, mayPick, pickCommand } from "../src/lib/draft-model.ts";
const target = "4f7c9484-bc03-46cf-ae5f-8a0781061844";
const url = "https://tgvuntuhdqucazpoxrrg.supabase.co";
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
