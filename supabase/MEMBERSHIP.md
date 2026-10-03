# Configurable league membership (local implementation; not deployed)

The current nine owners and scoring remain unchanged. Migration
`202610020001_league_membership.sql` removes the startup count restriction but
retains 65 rounds and all existing duplicate-pick/player and authorization rules.

## Commissioner workflow

Use a copy of `web/data/league-settings.json` as the proposed configuration.
Supply the complete owner list with permanent unique slugs, display names, and one
strictly descending nonnegative placement value per finishing position. Nine-owner
seasons retain 100,80,65,52,40,30,20,10,0. No expanded scoring table is invented.

This first administration interface is a local command, not a website form.
Only the TEST project is supported by the runner. Nothing runs automatically.
After offline review, apply the new migration to the test project, then use the
existing DRAFT_TEST_DATABASE_URL / CONFIRM / PUBLISHABLE_KEY and Doug email/password.
Run from supabase/tests:

    node configure-membership.mjs --preview /tmp/league-settings.json
    node configure-membership.mjs --apply /tmp/league-settings.json

Use the same NODE_EXTRA_CA_CERTS setting as other hosted tools when required.
Preview validates in a rolled-back transaction. Apply records an audit event,
updates membership and points, and saves the approved website configuration file.
If saving the file fails after commit, rerun the same configuration to recover.
No accounts or commissioner roles are granted by these commands.

## Safeguards

- Existing unused setup drafts must be explicitly cancelled, then recreated with
  the new owner order. Started drafts/season configurations cannot be rewritten.
- A departing owner is deactivated, never deleted. Their historical name is kept.
- Removal is blocked by owned players, pending proposals, accepted player moves,
  traded picks, or picks referenced in trade history. No history is erased to
  force contraction. Those cases need an explicit resolution plan.
- Only untouched future rookie picks for departing teams are removed. Active
  teams receive 10 picks for each of the next two calendar years.
- The commissioner must remain a participating owner.
- Startup creation and start require the approved participant set and placement
  table. Pool capacity and snake order scale with actual participant count.
- Fantrax saved data must include exactly the configured owners in all sports.
  Update league memberships manually on Fantrax before refreshing saved data.
- Each refreshed standings file carries its own placement table and championship
  year. Archives copy those fields, so future settings cannot rescore history.
  Legacy nine-owner archives retain the original table; other sizes require
  explicit scoring metadata. Upcoming scoring is never inferred from head count.

## Release sequence

Do not publish a changed configuration alone. Apply/test the migration in the
TEST project, preview membership, resolve any blockers, apply membership, link new
owner accounts using the existing verified-account process, align all five
Fantrax leagues, fetch complete data, validate roster imports, recreate the startup
setup, and review all website pages. Publish configuration and matching snapshots
together. A final league size and placement table are still required.

Production targeting and a browser commissioner membership editor are not included.
Run hosted authorization/concurrency validation against the test project before
production use; the new membership locking has only been tested offline locally.

## Isolated PostgreSQL validation in Codespaces

Existing started rehearsals intentionally prevent membership changes in the shared
Supabase test project. Preserve them. Test the change in a fresh Docker PostgreSQL
17 container instead:

    cd /workspaces/MultiSportFantasy2/supabase/tests
    npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
    npx --yes pnpm@11.25.0 test:membership-docker

No Supabase environment settings, cookie, or CA certificate are required. Docker
must be running. The runner creates a uniquely named container, random local-only
password, and loopback-only port with no host directory mounts. It applies all
migrations to an empty database and runs the same membership scenarios used by
the offline tests. No production or hosted test project is contacted.

Coverage: 10-owner expansion and 650 generated startup picks, 8-owner contraction,
rookie-pick counts, retained identities, incomplete roster rejection, invalid
placement-table rejection, commissioner checks, blocked browser roles, removal
of traded assets denied, and started/cancelled draft protection.

On completion (including failure), the runner prints commands to inspect and
remove that specific disposable container. Keep failure output before cleanup.
This is PostgreSQL integration validation, not a hosted Auth or multi-session
concurrency test. Test fixtures and points are synthetic and never exported to
website data files.

## Independent-session membership race tests

After transferring the tested runner files, run in Codespaces:

    cd /workspaces/MultiSportFantasy2/supabase/tests
    npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
    npx --yes pnpm@11.25.0 test:membership-concurrency

This creates another fresh disposable PostgreSQL 17 container. No Supabase
credentials or migration push is needed. The runner uses three independent
connections and requires `pg_blocking_pids` to confirm the second transaction is
waiting for the first. A sequential success is not accepted as concurrency proof.

Seven scenarios cover both operation orders for roster imports, trade acceptance
and draft setup, plus draft start winning against membership changes. Tests check
final membership, single pick transfer, no partial roster/draft writes, unchanged
settings/audit after rejection, and preserved clock and snake slots after start.
For trade acceptance the membership-first case is a compatible expansion; the
acceptance-first case is an incompatible contraction. These are deliberately
different operations. A pending proposal already prevents recipient removal.

The fixture uses real `prepareDraft` code but delegates its begin/commit/rollback
boundaries to the test harness so the transaction can be held open for a competing
session. Start and trade commands use the authenticated SQL role with simulated
JWT claims. This does not test hosted Auth or HTTP transport.

Local `membership-race-offline.test.mjs` runs the same scenarios sequentially in
PGlite to check assertions and fixtures; only the Docker command proves real
session blocking. No production constraints, permissions, or migrations are
changed for these tests. Keep the printed fixture inspection/cleanup commands.

## Commissioner League Settings page

`/league-settings` is available after applying
`202610020002_league_settings_api.sql` to the test project. The main-navigation
link appears only after the current signed-in user passes the commissioner read
check. Direct page visits by other accounts cannot read or change settings.

The editor permits adding/removing proposed owners and explicitly specifying
placement points for the current configured season. Preview shares the exact
validation function used by the existing trusted membership command, makes no
membership writes, and explains blockers. Apply requires a checked confirmation,
revalidates all prerequisites under the original locks, rejects stale previews,
and records an idempotent request plus the membership audit event. Lost responses
retry the same frozen request. The existing paused/started test drafts intentionally
block membership application; do not remove history to bypass them.

This page does not create Auth accounts, change Fantrax teams, or deploy files.
After successful application, download the approved league-settings.json and
coordinate its publication with matching Fantrax snapshots. Database changes alone
do not update the file-backed public scoring/roster views. Current connection
configuration remains restricted to the existing test project.

Validation before deployment:

- Run the full supabase/tests test suite and web `test:league-settings`.
- Apply only the new API migration to the test project after dry-run review.
- Sign in as Doug and verify the navigation link and preview.
- Sign in as an ordinary owner in a separate browser; the link must be absent,
  and directly opening /league-settings must show access denied.
- Preview a change with the existing started test draft: confirm it is blocked
  and there is no enabled Apply control.
- Successful hosted apply/retry should be rehearsed in a separate clean fixture
  environment; local SQL tests do not establish hosted HTTP/Auth success.
