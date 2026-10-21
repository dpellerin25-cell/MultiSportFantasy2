# Yearly Fantrax transitions — implementation and test plan

All changes are local until reviewed, pushed and installed. No active connection
changes during migration installation. All sports are configured for **automatic roster activation on detection** and
the GitHub workflow is disabled unless `FANTRAX_RENEWALS_ENABLED=true` is set.
Fantrax league renewal itself is still performed in Fantrax, never by this code.

## Architecture

- The checked-in `scripts/fantrax-connections.json` remains the bootstrap registry.
  `yearly-renewals.mjs export` merges approved database state into a temporary
  runtime registry. Python and Node consumers use `FANTRAX_CONNECTIONS_FILE`.
  A database/read error fails closed; no fallback to a retired league.
- `scripts/yearly_renewals.py` checks the current league again for history metadata
  and discovers the next numeric Fantrax season. An absent history ID means wait
  for renewal. Only one exact sport/history/year match is accepted. The accidental
  PGA duplicate `xtv5ph2gmulolm8g` remains excluded.
- Captures read **only the new league's pool**, not both seasons. They validate all
  current owners, all roster tables, all pagination, free agents/waivers, roster
  overlap, and before/after roster/metadata stability. Captures persist outside
  the repository and can be reused for six hours for the same pair. No guessed
  page-size parameters or parallel Fantrax requests are used.
- `yearly-renewals.mjs preview` compares the capture with stored draft/trade
  identities, membership and ownership. An active trade's expected transfer is
  allowed; unexplained loss/reassignment of rostered players blocks activation.
- A handoff takes the existing roster and source-import locks, preserves UUIDs,
  source aliases and history, imports the new complete roster and records the
  connection/log in one transaction. Retired roster and player-pool imports fail.
  Unchanged plan retries are idempotent; errors roll back the current handoff.
- The database is the active connection authority after enabling the workflow.
  A failed Git push cannot lose an activated league mapping. Public roster JSON
  catches up at the next regular update. Draft pools already frozen are unchanged.

## Activation policy and approval

`scripts/fantrax-renewal-policy.json` has a rule per sport:

```json
{"mode":"automatic","activation":"on_detection","automatic_month_day":null}
```

This is the approved timing for all five sports: activate rosters on the first
successful scheduled discovery and validation of a renewed league. Fantrax renewal
is still performed manually by Doug. There is no calendar-date delay. The daily
workflow is polling, not an instant Fantrax notification. Membership, owned-player
identity and complete-capture checks must still pass before activation.
Standings remain on their previous connection until separate archive approval
and release. No automatic standings-release policy is configured.

### Automatic per-sport archives

The automatic workflow now runs `scripts/archive_renewed_sports.py` after successful
renewal previews and before roster activation. It fetches fresh `getStandings`
results from the old league, validates complete membership, scores and placement
points, and writes that sport to `web/data/history/<championship year>/` with the
existing archive metadata format. The Cup is named for its starting year. Fantrax year conversion must be verified
against captured metadata using the shared championship calendar; unknown sports block archive/release. The year must match the configured championship,
preventing a pre-launch league from being archived as championship results.

Only the detected sport is saved. Other sports are not marked final. Existing
matching archives are reused without modification; conflicting archives stop the
run. The workflow commits and pushes only `web/data/history` before any roster
handoff. Archive or push failures prevent that run's handoffs. Branch protection
must permit this workflow's archive publication; it does not bypass protections.
Automatic runs must use the default branch. Preview/discovery runs do not archive.

Archiving does not release the live standings connection or change the season
configuration's final flags. The existing championship-finalization and standings
release process remains separate, including Trophy Case eligibility. A successful
archive followed by a failed handoff is safe: the next run reuses the archive.
No database migration is needed for automatic archive creation.

Offline validation: `PYTHONPATH=scripts python -m unittest test_archive_renewed_sports
test_yearly_renewals test_fetch_update_modes` (enter on one line).

The GitHub enable variable remains required. If it is already enabled, deploying
this policy permits automatic roster activation on the next eligible run. Modes
are disabled, manual, automatic. Legacy date policies remain supported using
`activation: "on_date"` and an annual UTC `automatic_month_day`.

Manual preview prints a SHA-256 approval hash of the complete evidence. Set
`FANTRAX_RENEWAL_APPROVE` to that exact hash for `apply`. A changed capture needs
a new approval.

After `202610200001_owned_renewal_checks.sql`, missing IDs/name differences for
unowned players are warnings, not blockers. Only exact ID/name/sport matches get
new-season aliases. Unmatched unowned identities remain historical; the subsequent
new-season pool import creates independent identities without modifying old pools.
No retired/deleted-player inference or name-based merging occurs.

Owned players, proposed/accepted trade assets, reserved players and non-voided
selections in non-retired drafts still require matching evidence. Retired rehearsal
selections do not block. A player on an owner's roster who disappears, changes name
or moves unexpectedly still blocks activation. Complete membership, pagination,
freshness, destination-conflict and sport checks remain in force. These rules are
rechecked under database locks; an owner acquiring a player after preview cannot
be silently bypassed. Historical-only exceptions no longer need a manual review
list; existing reviewed_absent_ids fields never override protected-player checks.

## Standings and championship history

Rosters and standings have separate IDs. A roster renewal does **not** replace
standings. Archive final results with the existing archive command; it protects
existing history files. This system does not infer that a season is final or
invent champions. Review/final-result approval remains a commissioner decision.

The separate command, from supabase/tests:

```bash
node release-renewed-standings.mjs preview MLB 2027
```

requires an existing matching archive and metadata, an approved new roster league,
and the website's championship year configured for the new sport season. It prints
a hash. After reviewing, use `apply MLB 2027` with FANTRAX_RENEWAL_APPROVE set.
For scheduled release after approval, add to that sport's policy:

```json
{"standings_release":{"archive_year":2027,"approval_hash":"EXACT_PREVIEW_HASH"}}
```

The scheduled worker will only apply that exact archive/league pair. A later season
requires fresh final-results approval. Standings remain pinned to their old
championship year; changing website settings alone cannot relabel old scores.
Website season labels/statuses and membership still use the existing configuration
process; Fantrax renewal is not authority to declare a new Pentagon Cup season.

The old MLB league is a setup/test league, so do not create fake final results for
it. A one-time manual `preview-initial MLB` / `apply-initial MLB` mode exists with
`FANTRAX_INITIAL_RELEASE_REASON` (at least 20 characters). It binds the old live
data checksum and records an initial-setup exception without creating an archive.
Initial exceptions cannot be scheduled or reused after a prior standings release.

## Ordered testing — finish these before production

1. **Offline regression suite** (no secrets): `pnpm test` in supabase/tests and
   Python unit tests including test_yearly_renewals and test_fetch_update_modes.
2. **Disposable PostgreSQL** in Codespaces: `pnpm test:mlb-docker`. It now runs nine
   independent-session scenarios: four legacy MLB plus five generic handoff/import
   races, including stale ownership and retired player-pool rejection. Docker is
   unavailable on the local Windows environment; this stage must run in Codespaces.
3. **Test-project migration only**: review dry run for
   `202610150001_yearly_renewals.sql`, then install in the test project. Do not
   enable the production workflow. Existing active trades need not be deleted.
4. **Test-project runtime export/discovery** using the commands below. Verify the
   original connections remain and the excluded PGA league is never selected.
5. **New-season capture and preview** for MLB. Resolve missing-ID/name/membership
   blockers from the preview. The prior two-season summary cannot replace a full
   capture, but the new command avoids fetching the old season's 531 pages.
6. **Approved test-project apply** only after preview review. Verify preserved
   draft IDs, old archives, pending trades, runtime registry, and fresh import.
   Repeat the exact apply to verify retry behavior; do not edit the capture.
7. **Standings preview**: test archive gating and initial-setup exception separately.
8. **GitHub test environment**: manually run discovery, preview, then a due automatic
   policy with reviewed test fixtures. Check the nine-race suite before this stage.
9. **Production rollout**: confirm the production project's migration/state, choose
   policy dates, configure environment approval and explicit project confirmation,
   then enable daily discovery with manual rules first. Enable automatic rules one
   sport at a time after a successful controlled transition.

## Codespaces commands (test project)

Use the same private test database URL and CA certificate as before:

```bash
export TRADE_ROSTER_PROJECT_REF=tgvuntuhdqucazpoxrrg
export TRADE_ROSTER_DATABASE_URL="$DRAFT_TEST_DATABASE_URL"
export FANTRAX_RENEWAL_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
cd /workspaces/MultiSportFantasy2
node supabase/tests/yearly-renewals.mjs export /tmp/fantrax-runtime.json
export FANTRAX_CONNECTIONS_FILE=/tmp/fantrax-runtime.json
python scripts/yearly_renewals.py --directory /tmp/yearly-renewals
```

Discovery needs FANTRAX_USER_SECRET_ID privately set. Capture also needs a current
FANTRAX_COOKIE. When ready for the new-season-only capture:

```bash
python scripts/yearly_renewals.py --directory /tmp/yearly-renewals --capture MLB
node supabase/tests/yearly-renewals.mjs preview /tmp/yearly-renewals/MLB-capture.json
```

Add `--refresh` to the Python command to discard a reusable capture and fetch
fresh evidence, for example after resolving a roster-ownership blocker.

To review an older saved capture without fetching players again, run
`node supabase/tests/yearly-renewals.mjs audit /tmp/yearly-renewals/MLB-capture.json`.
Audit uses a read-only transaction, permits older evidence, and prints no approval
hash. Normal preview and activation still enforce the six-hour freshness limit.

For the initial MLB identity differences, save the audit and inspect the verified
league-info response without downloading any player pages:

```bash
node supabase/tests/yearly-renewals.mjs audit /workspaces/fantrax-renewal-evidence/MLB-capture.json > /workspaces/fantrax-renewal-evidence/MLB-audit.json
python scripts/audit_mlb_identity_details.py --report /workspaces/fantrax-renewal-evidence/MLB-audit.json > /workspaces/fantrax-renewal-evidence/MLB-identity-details.json
```

The Python diagnostic uses FANTRAX_COOKIE and only two known getLeagueInfo reads.
Use `--offline` for saved-name classification with no network requests. Metadata
playerInfo shape/coverage is not assumed: only matching IDs and allowed scalar
player fields are retained. Unknown fields, credentials and raw API errors are not
printed. No mapping is approved, renamed, merged or deleted. Absence never proves
retirement; a same-name different-ID collision requires player-card evidence.
If metadata is insufficient, capture the actual player-card Network request and
response in both leagues, including stable IDs and distinguishing player details,
with credentials removed. Do not guess a detail/search endpoint.

Only after preview review, set FANTRAX_RENEWAL_APPROVE to its hash and run:

```bash
node supabase/tests/yearly-renewals.mjs apply /tmp/yearly-renewals/MLB-capture.json
node supabase/tests/yearly-renewals.mjs export /tmp/fantrax-runtime.json
```

Re-export before every later fetch/import in the same terminal. The scheduled data
workflow does this automatically. Never restore the static registry over an active
database transition, or disable runtime resolution after activation.

## GitHub configuration (after tests)

- Environment: `fantrax-renewals`, with required reviewers during staged rollout.
- Variables: FANTRAX_RENEWALS_ENABLED, FANTRAX_RENEWAL_PROJECT_REF and
  TRADE_ROSTER_PROJECT_REF. The two project references must agree. Leave enabled
  false/unset until the migration and test stages pass.
- Secrets: FANTRAX_COOKIE, FANTRAX_USER_SECRET_ID, TRADE_ROSTER_DATABASE_URL and
  TRADE_ROSTER_CA_CERT (complete PEM text). Use test-project overrides in the test
  environment; do not inherit production credentials accidentally.
- The new workflow runs at 3 am America/New_York, before existing 4 am updates.
  Both workflows share a concurrency group. Existing roster/standings schedules
  are unchanged. Enable TRADE_ROSTER_SYNC_ENABLED for the regular full-roster sync.
- Evidence/preview artifacts are retained seven days. Job summaries identify the
  mode and results; enable GitHub Actions notifications for failed runs. This is
  not a new email notification service. No external message is sent by local tests.

## Failure recovery

A blocked sport stays unchanged. Separate sports can succeed independently; inspect
the run rather than assuming all-or-nothing across five leagues. If a connection is
lost at COMMIT, rerun the identical capture/approval to confirm the logged outcome.
Re-export runtime connections after any successful or uncertain apply. Archive/
standings release is separate and never implied by roster success. Do not reverse
an activated transition by deleting logs or changing old IDs; first inspect any
new imports/trades and prepare a reviewed forward correction. All immutable old
snapshots, aliases and draft history remain available for that investigation.
