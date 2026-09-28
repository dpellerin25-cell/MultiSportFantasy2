# Draft interface Phase 1

The `/draft` public shell contains no private league data. Browser sign-in uses
Supabase email/password Auth; no signup, owner selector or impersonation flow is
provided. Existing accounts must already be linked by the administrator. The
Supabase client persists/refreshes its user session locally; sign-out clears this
browser session and unmounts private draft state/subscriptions. Auth UI is not
an authorization boundary: every RPC and Realtime row is protected by the
existing database functions/RLS and JWT verification in Supabase.

## Local configuration

Add these public values to `web/.env.local` (do not overwrite existing settings):

```dotenv
NEXT_PUBLIC_DRAFT_SUPABASE_URL=https://tgvuntuhdqucazpoxrrg.supabase.co
NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY=your_actual_sb_publishable_key
NEXT_PUBLIC_DRAFT_ID=4f7c9484-bc03-46cf-ae5f-8a0781061844
```

Restart the dev server after adding them. Public variables are compiled into
production builds, so changing deployment variables also requires a rebuild.
This phase deliberately accepts only the known TEST project and a publishable
key starting `sb_publishable_`. It refuses secret/service keys and other project
URLs. No real key has been added to this repository by this task. Without valid
configuration, `/draft` displays a clear configuration message and makes no
Supabase calls. Never add database passwords, service-role keys or Fantrax cookies
to public variables. Do not configure production deployment in this phase.

## How it works

- `draft_state` supplies authoritative state, participant identities,
  `viewer_owner_id` and `viewer_is_commissioner`. Names do not grant privileges.
  The latter controls only visibility of the Phase 2 commissioner placeholder;
  no commissioner command buttons are included yet.
- `draft_available_players` supplies search/sport/cursor pages of 30 eligible
  players. Changing filters, picks and revision signals refreshes results.
  Supabase IDs are internal player UUIDs; Fantrax mappings remain in the backend.
- Picking opens a native modal dialog. The exact pick ID, revision, player ID
  and new request UUID are captured at selection time. If draft state changes
  before confirmation, cancel and choose again. The server still validates
  turn, deadlines, eligibility, minimum feasibility and all uniqueness rules.
- The modal sends `draft_command` with action `pick`. It never supplies the
  caller's owner ID. Backend validation errors are shown as text. An uncertain
  network result retains the same request envelope for a safe explicit retry;
  double clicks are blocked. Refreshing/closing the page discards this in-memory
  retry envelope; the next load retrieves committed state rather than resubmitting.
- Realtime subscribes only to `draft.live_updates` revisions using the signed-in
  client's JWT. State and player pages are refetched from RPCs. Initial load,
  reconnect, window focus and a 15-second fallback poll recover missed updates.
  No optimistic draft state is used. Stale filter responses are ignored.
- Countdown display uses the server timestamp plus monotonic browser elapsed
  time. It is approximate (network latency) and never submits expiration or
  changes server deadlines. Backend cron controls skipping even with browsers
  closed. Zero displays a waiting message until authoritative state advances.
- Desktop has the player list plus board/roster placeholders; mobile stacks
  sections. Sign-in inputs have autocomplete and the native modal handles focus.

## Verification

Implementation verification: all existing offline backend suites and four new
frontend integration tests passed; full ESLint and TypeScript checks passed.
`next build --webpack` with `NODE_OPTIONS=--use-system-ca` passed. The initial
default Turbopack build failed to fetch the existing Geist/Geist Mono Google
Fonts in this environment; no font/style changes were made to bypass that.
Node reports a harmless module-type detection warning when directly loading the
TypeScript model in tests. Node 24 is recommended for these tests (the new SDK
requires Node 22+). The unconfigured `/draft` shell was inspected in the browser.
Authenticated browser/mobile acceptance awaits the public configuration and
test-account sign-in; no hosted draft was started or changed during this task.

`npm run test:draft` runs Node 24+ tests for configuration guards, owner/turn
affordances, exact idempotent request construction and mocked Supabase Auth → JWT
RPC → sign-out integration. These are not live browser/hosted acceptance tests.
Backend suites remain in `supabase/tests`; no migrations or rules changed.

Manual two-account acceptance still required in the TEST project: sign in as
Doug and the ordinary account, confirm mapped identities and commissioner shell,
verify an unlinked account is denied, and on a separately started disposable
draft test a pick/confirmation, cross-owner refresh, pause/expiry, reconnect and
sign-out. The existing rehearsal is setup/unstarted, so pick controls should be
disabled there. Full commissioner controls are Phase 2; use existing test tools
to prepare a disposable running draft, not production. Test mobile at 375px and
keyboard-only modal navigation. No real Auth credentials were available locally.

Remaining concerns: browser sessions use SDK-managed browser storage, so XSS
prevention remains important; React renders errors/player strings as text. The
backend presently returns all pick slots in state (585 is bounded for startup).
Search ordering follows existing internal UUID pagination, not rankings. Only
Doug/Chris test accounts have been linked so far. Remaining owners must be linked
before the nine-person rehearsal. Password recovery/invites, full draft board,
rosters/minimum progress and commissioner controls remain Phase 2.
