# Controlled MLB renewal — not activated

## Fresh live MLB validation

`scripts/validate_mlb_renewal.py` uses the verified getLeagues/getLeagueInfo,
getStandings, getTeamRosterInfo and getPlayerStats requests for only the approved
2026 MLB league and verified 2027 candidate. It does not change the registry,
website files, Supabase or Fantrax. No PGA league is contacted.

In Codespaces, set FANTRAX_COOKIE and FANTRAX_USER_SECRET_ID privately, then:

```bash
cd /workspaces/MultiSportFantasy2
python scripts/validate_mlb_renewal.py > /tmp/mlb-renewal-validation.json
cat /tmp/mlb-renewal-validation.json
```

The report validates the season/history/sport pair, checks new-league membership
against local approved settings, reads all available-player pages in both leagues
(up to 1000 per league), checks live roster overlap, and re-reads rosters afterward
to detect concurrent changes. Missing John is reported in old-league membership;
new-league membership must match exactly. Valid empty roster tables are allowed;
missing tables are not treated as empty. Player-ID/name differences and old rostered
players absent from the new roster/pool require review. Counts and small samples
are printed; raw authenticated responses and credentials are not printed.

Exit 0 means capture checks passed, 2 means a report with blockers, and 1 means
capture failed. Captures are sequential, not an atomic snapshot. Available plus
rostered players may not cover every Fantrax status; old-only IDs alone do not
prove deletion. This does not compare all existing Supabase source rows or validate
a full standings import. Review the report before considering activation. This
can require over 1,000 page requests combined; progress goes to stderr.

Offline tests: `python -B -m unittest discover -s scripts -p test_validate_mlb_renewal.py`.

## Disposable Docker rehearsal (safe with active Supabase trades)

From Codespaces, after pulling the updated files:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:mlb-docker
```

No Supabase URL, Fantrax cookie or CA certificate is needed. The runner starts a
uniquely named PostgreSQL 17 container with an automatically generated password,
a loopback-only random port, and no host directory mounts. It creates only empty
disposable databases, installs local migrations there, then runs the rollback-only
rehearsal and four real independent-session scenarios:

- Renewal first: waiting old-roster import rejected, pending trade preserved.
- Roster first: completed transfer and owner identity survive the waiting renewal.
- Two renewals: one handoff, second request an idempotent retry.
- Player-source write first: waiting renewal includes the newly committed alias.

Each race must observe the second backend blocked by the first in PostgreSQL.
All scenarios also verify retained historical snapshots, stable player UUIDs and
successful completion using a new-league synthetic roster. The player-source
scenario exercises the importer's lock/identity-write section, not a full live
player-pool export. No hosted Auth, HTTP, live Fantrax or production activation
is tested. `mlb-race-offline.test.mjs` runs those scenarios sequentially for local
development; it cannot prove concurrency.

The container and fixtures remain for inspection. The runner prints the exact
container name, inspection command and optional removal command. Race fixtures
are in `multisport_mlb_race_1` through `multisport_mlb_race_4`; the rollback-only
rehearsal uses `multisport_mlb_test`. Remove only the printed disposable container
when finished. If Docker is unavailable, run the command in Codespaces with Docker.
Do not point the concurrency script at Supabase; its guard rejects remote hosts.

## Rollback-only hosted rehearsal

After the migration and read-only preview pass in the test project, run from
`supabase/tests`, with the existing test database URL and confirmation set:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node rehearse-mlb-renewal.mjs
```

The runner targets only the configured test project with verified TLS. It requires
no existing MLB trade players, no active proposed/accepted trades and an unapplied
renewal. It serializes with importers, exercises the handoff with existing draft
source identities plus synthetic roster/trade fixtures, checks retired-ID rejection
and confirmation, then always rolls back. It never issues COMMIT. Historic snapshots
and old source IDs are checked unchanged. Fixture rows are checked absent afterward.
Database sequence values can advance even on rollback. This is not a live Fantrax
capture, HTTP/Auth test or multi-session race test, and does not authorize activation.
Run `node mlb-rehearsal.test.mjs` for the same scenario offline.

Approved old league: `60ri2nbhmtj4b0km` (2026).
Verified candidate: `rk8bvnk3mulovx9a` (2027).
Shared history: `ml3fdlq2mulovxoh`.

`scripts/fantrax-connections.json` is now the shared approved registry for
standings/roster fetching, player-pool diagnostics, player-pool import validation,
and trade roster import validation. All original IDs remain approved. Archived
website data is not rewritten. Changing target_season_year only affects discovery.
The old preview-only registry has been removed to avoid conflicting settings.

The local migration adds an administrator-only, invoker-security MLB handoff.
Installing it performs no handoff. Its default mode is a preview. Activation
preserves trading player UUIDs and ownership, pending trade assets/reservations,
and immutable old roster snapshots. It adds new Fantrax source aliases to the
same draft player UUIDs, retaining old aliases and frozen draft pools. A later
fresh roster import confirms transfers normally. Old-league imports are rejected
after activation; snapshots must be newer than the previous season's last import.
Destination identities already present require manual review, never automatic merge.

## Next validation stages

1. Run `node mlb-renewal.test.mjs` in `supabase/tests`. This is an offline PGlite
   test, not hosted or independent-session concurrency validation.
2. Review the migration and test it in the disposable Supabase test project only.
   Do not activate production or edit the approved MLB ID yet.
3. After installing the migration in that test project, with existing
   DRAFT_TEST_CONFIRM and DRAFT_TEST_DATABASE_URL settings, run:

   `NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node preview-mlb-renewal.mjs`

   This runner starts a read-only transaction and always rolls back. It accepts
   no activation option. Share its counts and blockers before proceeding.
4. Before activation, obtain fresh metadata plus complete new-league rosters and
   player-pool captures. Validate owner membership, sport and stable Fantrax IDs.
   Metadata alone does not establish roster completeness. Do not invent or infer
   ownership from an empty roster. Rehearse the handoff and five-sport import in
   the test project, including active trade and frozen draft-pool fixtures.
5. Production activation requires a coordinated maintenance window: stop and drain
   roster AND player-pool imports, archive the appropriate completed standings,
   run the reviewed database handoff, update the approved registry, deploy it,
   import validated fresh snapshots, then resume jobs. Keep standings on their
   intended season; do not overwrite unarchived final results. Separate roster
   and standings connection fields are needed if their rollover dates differ.

The activation helper is intentionally fixed to this verified MLB pair. No
scheduled activation or generic renewal endpoint is provided. It uses the same
advisory locks as trade roster writes and player-pool imports; multi-session
handoff races still need disposable PostgreSQL validation before production.
An identical retry is harmless. Do not reverse a handoff by editing IDs or
deleting snapshots; post-activation recovery needs a reviewed plan based on any
imports/trades that have occurred since activation.
