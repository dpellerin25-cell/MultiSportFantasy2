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
