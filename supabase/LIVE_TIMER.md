# Real-time revision signals and database timer

Implementation is local only. Nothing has been applied or scheduled on Supabase.
The existing startup rehearsal remains unstarted. Website pages are untouched.

## Architecture

`202609260002_live_timer.sql` adds:

- `draft.live_updates`, containing only draft UUID, revision, update time. A
  transactional trigger updates it on draft creation/revision changes. Rolled
  back picks never publish committed changes. No player, auth account or audit
  payload is published. Direct writes are not granted to clients.
- A SELECT RLS policy uses `draft.can_read_live` to check the same active-owner
  membership/commissioner access as the API. This narrow SECURITY DEFINER boolean
  helper has an empty search path; outsiders see no signal rows. The private
  draft schema does not need to be exposed in the Data API for Postgres Changes.
- `draft.expire_due_picks(50)`, a privileged SQL-only worker. It uses the same
  draft-row lock as pick/pause/resume commands and `SKIP LOCKED`. It processes
  each due draft at most once per invocation, leaves expired slots unfilled,
  calls the existing next-turn helper, increments revision and records a
  `timer_expire` event with a null actor (no commissioner impersonation).
  Browser roles cannot invoke it. A repeated call does not re-expire a pick.

`configure-live.mjs --enable` publishes ONLY `draft.live_updates` in the existing
Supabase Realtime publication and schedules a named pg_cron job every 5 seconds.
The script enforces the existing exact TEST project connection restrictions.
Repeated enable updates that same job instead of adding a duplicate. Cron runs
inside Postgres even with browsers and Codespaces closed; it needs no user Auth
session, external scheduler, browser database password or service key.

Deadline enforcement is immediate in the command engine; advancement normally
follows within a scheduler tick plus database delay. This is not a millisecond
timer guarantee. A delayed worker gives the next owner a fresh full timer rather
than skipping multiple owners to catch up. A paused database/project cannot run
jobs; on recovery only the due current turn advances. Paused drafts never expire.
Cron batches up to 50 drafts. A SQL failure rolls back that whole batch and is
visible in cron job history; investigate failures rather than ignoring them.

`live-draft-client.mjs` is an injectable Supabase-client subscription adapter for
the future UI. It refetches `draft_state` on revision events, initial load and
reconnect, serializes refreshes and polls every 15 seconds as a missed-event
fallback. Consumers must refresh their available-player page when the received
revision changes. Use an authenticated client with token refresh configured;
close the watcher when leaving/signing out. Realtime isn't an authorization or
state source of truth: reads and commands remain checked by the database.

## Transfer and local PostgreSQL concurrency validation

After transferring changes to GitHub/Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test
```

The isolated test package now includes pinned `@supabase/supabase-js`; no website
dependencies changed. Run `pnpm test:concurrency` using a NEW EMPTY disposable
local PostgreSQL database as documented in COMMANDS.md. That runner deliberately
refuses previously populated databases and remote/Supabase hosts. It now includes
worker-versus-held-lock and simultaneous-worker checks. If the old test container
still exists, use a new container name and free local port instead of deleting it.
Keep `LOCAL_DRAFT_TEST_DB_URL` separate from `DRAFT_TEST_DATABASE_URL`.

## Apply and enable in TEST only

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

After the five prior migrations, only `202609260002_live_timer.sql` should appear.
Review before applying:

```bash
npx supabase db push --linked
cd supabase/tests
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node configure-live.mjs --enable
```

Use the same exported test database URI as before. This activates expiration for
ALL running drafts in the TEST project; setup/paused/completed drafts are ignored.
Check status with `--status`. Stop the scheduled job with `--disable` (publication
stays enabled). If pg_cron is unavailable or unsupported, stop and report the
error. Do not substitute a minute-based schedule for the configured timer test.

Monitor in Supabase Cron or SQL Editor:

```sql
select jobname, schedule, active from cron.job
where jobname = 'multisport-draft-expiry';
select status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname='multisport-draft-expiry')
order by start_time desc limit 10;
```

## Hosted two-client test

Requires the previously linked Doug/Chris test accounts and exported publishable
key/account email/password settings, in addition to the database URI/confirmation.

```bash
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node realtime-hosted.test.mjs
```

Creates a separate clearly labeled TWO-owner, FOUR-pick fixture using synthetic
players. It does not change draft `4f7c9484-bc03-46cf-ae5f-8a0781061844` or its real
player snapshot. It verifies both authenticated subscribers receive committed
revisions, a selected player is excluded for both, pause survives scheduler
ticks, and pg_cron advances an expired turn with all subscriptions disconnected.
The fixture's paused remaining time is explicitly shortened by admin SQL solely
to keep the test short; resume still uses the real command. Then it reconnects,
refetches state and assigns the skipped slot without consuming the current turn.
Normal success/failure cleanup cancels the fixture and prints its UUID. Its
history, snapshot and synthetic players remain for inspection; no deletions.
If the process is forcibly killed, cancel that disposable fixture manually using
its row in `draft.drafts`, or disable the test scheduler until inspected.

## Tested here / remaining gates

All existing offline suites plus timer and client-adapter tests passed. Tests
cover transactional signal rollback, single expiry/retry, new deadlines,
paused/setup exclusions, final makeup state, system audit identity, signal RLS,
client write/worker denial, initial refresh, reconnect and subscription cleanup.
The existing schema privilege test now explicitly permits the one new narrow
membership helper; write constraints are unchanged.

Docker/PostgreSQL is unavailable on this Windows host. The extended two-session
test and hosted Realtime/pg_cron integration test are supplied but NOT run here.
No production-readiness claim until those pass. The live test verifies delivery
to two members; outsider visibility is tested at SQL RLS level, not a third
hosted websocket. Supabase itself must be available for scheduling and delivery.

References:
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://supabase.com/docs/guides/cron/quickstart
