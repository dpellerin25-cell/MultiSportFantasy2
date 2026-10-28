# Scoring ledger — local foundation

Migration: `supabase/migrations/202610270001_scoring_ledger.sql`.
This adds the private `scoring` schema. It does not import Fantrax data, schedule
jobs, change published totals, or enable a website pause control.

## Stored evidence

- `seasons`: sport, Fantrax league, starting season year, explicit test/production
  scope and championship year. Production starts at Cup 2027. Each sport has
  one production season per Cup; test seasons have no championship assignment.
- `periods`: daily dates for NFL/MLB/NBA/EPL; Thursday–Sunday tournament periods
  for PGA, retaining its source period number and label.
- `results` and `contributions`: immutable revisions of one owner's team result,
  retaining external player IDs, names, starter/bench status, raw scores, missing
  record status, source observation time and reconciliation totals.
- `roster_checks`: immutable per-owner count revisions with five-sport counts,
  source references and observation times. Counts must include IR and minors.
- `pause_events`: commissioner identity, reason, database effective time and
  append-only pause/resume history. The browser cannot backdate an event.
- `decisions`: immutable evaluation records referencing the scoring result and
  the exact roster-check/pause evidence used.

All data and importer functions are private to trusted database maintenance.
RLS is enabled, with no browser read/write policies. Only authenticated
commissioner pause and PGA decision commands have execute grants; no public HTTP wrapper is
added. Database administrators remain trusted and can insert historical fixtures.
Existing draft/player/trade records are referenced, not rewritten.

## Rules and corrections

Daily eligibility uses the following day's Eastern roster check. PGA uses both
Thursday and Sunday checks, and remains pending until Tuesday 8 a.m. Eastern.
Daily results also require finished events. PGA's deadline is the agreed
finalization policy, not a claim that Fantrax exposes a final flag.

The cap is 65. Overages remove each positive **starter** contribution and retain
negative starter contributions; all bench contributions are excluded. Missing
checks, incomplete checks and unknown starter scoring remain pending. A missing
score is not zero: `no_activity` needs explicit supporting evidence, while an
explicit zero uses `known` with numeric zero.

Complete roster evidence currently requires all five observations in the 4 a.m.
Eastern hour on the check date. A delayed or partial run must be recorded as
incomplete rather than used to assess a penalty. This is a conservative evidence
guard, not a new roster grace period. The scheduled importer and its late-run
policy still need implementation and validation.

Pausing is evaluated at the scheduled check time and does not erase prior
penalties. If PGA is paused at only one of its two checks, the outcome is pending:
Doug must review that result and choose to enforce the standard two-check cap rule or waive the penalty. Missing counts remain pending
even when penalties were paused.

Import commands require a request UUID and expected revision. Identical retries
return the original record; changed payloads or stale revisions fail. Corrections
append new evidence with a reason, never update history. Scoring corrections
must have a later observation time. Imports reconcile starter and bench totals
and fail atomically on invalid or duplicate player rows.

All mutation commands share a transaction advisory lock, with unique constraints
as an additional guard. This favors correctness over throughput for this small
league. Multi-session lock behavior has not yet been tested for these functions.

`latest_results` and `latest_roster_checks` select revisions rather than summing
them. `current_outcomes` re-evaluates current evidence, so old stored decisions
cannot become a stale published-score cache. Future season totals must group by
championship, sport and owner, exclude `is_test`, and keep pending outcomes
distinct from zero. An old decision request retries its original audit result;
use a new request UUID to record a correction's decision.

## Local validation and next steps

### Commissioner resolution for mixed PGA pauses

This control is implemented at the database-command layer; the website control
and HTTP wrapper remain part of the future scoring interface.
`scoring.review_pga_resolution(result_id)` returns the current outcome, exact
check evidence and last resolution ID. After confirmation,
`scoring.resolve_pga_pause(request_id, result_id, choice, reason, expected_checks,
expected_resolution)` accepts `enforce` or `waive`.

- **Enforce** applies the normal PGA rule: positive starter points are removed
  only if both checks exceeded 65; negative scores remain.
- **Waive** keeps all starter points for that tournament.
- Both commands require a commissioner. Decisions require a reason, preserve
  the actor and history in `pga_resolutions`, and support exact retries.
- A stale preview fails. Corrected scores or revised roster/pause evidence
  invalidate the prior resolution and require another review. Decisions can be
  corrected by appending a new resolution with the previous resolution ID.
- This is limited to mixed-pause PGA results after the deadline with complete
  counts and known starter scoring. It cannot bypass other pending conditions.

All fixtures in `scoring.test.mjs` are synthetic database edge cases, not claimed
Fantrax captures. The shared read-only diagnostic remains the source of captured
request/response validation. Tests initialize an isolated in-memory PostgreSQL
instance and apply all local migrations there; no credentials are needed.

After transferring the reviewed files to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:scoring
npx --yes pnpm@11.25.0 test
```

Next, validate scoring imports/check corrections/pause changes in independent
PostgreSQL sessions before hosted rollout. Hosted Auth, HTTP authorization and
scheduled job integration are not covered by this offline suite. Do not apply
this migration to production yet. No Supabase action is required for local tests.

### Disposable PostgreSQL concurrency runner

After committing/pushing the reviewed runner files yourself, run in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:scoring-race-offline
docker info
npx --yes pnpm@11.25.0 test:scoring-concurrency
```

The runner creates a uniquely named PostgreSQL 17 container, a random temporary
password and a loopback-only port. No Supabase or Fantrax credentials are needed.
It refuses a nonempty database and only accepts the named local disposable test
database. It applies migrations inside that disposable database, not Supabase.

Ten scenarios cover duplicate imports, conflicting retries, competing score
corrections, count/decision races in both orders, concurrent pause changes,
conflicting PGA decisions, stale count evidence, PGA retries, and superseded
scoring evidence. Three independent connections are used: two competitors and
one lock observer. Every scenario must observe the second backend blocked by
the first through `pg_blocking_pids`; merely running in sequence cannot pass.
Statements and lock observation have bounded timeouts.

Expected final line: `10 scoring concurrency scenarios passed. No hosted database
contacted. Fixture data remains in the disposable database.`

The container and synthetic records are retained, including on failure. The
runner prints exact inspection and removal commands for that specific container.
Use that printed removal command when finished; do not remove unrelated containers.
If a test fails, keep its output and container for diagnosis. Do not apply the
scoring migration to hosted Supabase based solely on the offline rehearsal.

### Hosted scoring validation (TEST project only)

`scoring-hosted.test.mjs` only permits `tgvuntuhdqucazpoxrrg`. It performs real
Auth sign-in, then tests SQL `authenticated`/`anon` role authorization using the
verified user IDs. This is not an HTTP RPC, website or Realtime test. It needs
existing confirmed Doug and Chris test accounts linked to their active owners,
with Doug already commissioner and Chris not commissioner. It grants no roles.

After transferring/pushing the runner and after disposable concurrency passes:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
node scoring-hosted-offline.test.mjs
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the list. For this task the only new migration should be
`202610270001_scoring_ledger.sql` (or none if already applied). Stop and inspect
unexpected migrations. Apply only to that confirmed test project:

```bash
npx supabase db push --linked
cd /workspaces/MultiSportFantasy2/supabase/tests
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" \
  node scoring-hosted.test.mjs
```

The shell also needs `DRAFT_TEST_DATABASE_URL`, `DRAFT_TEST_PUBLISHABLE_KEY`,
`DRAFT_TEST_DOUG_EMAIL`, `DRAFT_TEST_DOUG_PASSWORD`, `DRAFT_TEST_OWNER_EMAIL`,
and `DRAFT_TEST_OWNER_PASSWORD` from the previous hosted tests. OWNER means Chris.
Passwords for these accounts are Auth passwords; the URI contains the separate
database password. The CA file must exist. Never disable TLS verification.

All synthetic scoring rows and pause/resolution commands run inside a single
rollback-only transaction with bounded timeouts. Existing scores and account
links are not modified. The runner briefly holds the scoring mutation lock;
run it when the test project is idle. Reserved Doug check dates June 11/14, 2020
must be unused; it refuses existing data rather than deleting it. No notifications,
Fantrax requests or production connections are involved.

Rollback removes fixture rows even on failure; identity sequences may retain
gaps, and Auth sign-in sessions may remain until expiry. A dropped connection
also aborts the open transaction. Final success reports rollback and scope;
do not confuse offline scenario output with an actual hosted run.

