# Inaugural roster transitions

Only these known pre-launch sources may skip championship archiving on a validated
2026 to 2027 roster handoff: NFL `yg0olhfrmtj45dd6`, NBA `u1byx3qkmtj47ogg`,
EPL `j08ymyupmtj415q3`, PGA `xa7tza2hmthqz8bo`.
They are pinned in `scripts/initial-season-exceptions.json`. MLB is excluded;
its completed transition and earlier audit records are untouched.

The archive stage reports `archive_exemption: initial_2027` without fetching or
saving 2026 championship results. Matching successful database preview and fresh
capture remain required. All existing identity, membership, trade, destination,
and lock checks run during the normal handoff. The retained standings connection
must still be the pre-launch source.

Migration `202610220001_initial_roster_audit.sql` adds a nullable exemption column
and an insert trigger to the existing private transition log. The trigger labels
only newly inserted matching inaugural transitions. It runs in the same transaction
as the handoff: rollback removes both; an identical retry creates no duplicate.
Existing rows remain null. No new permissions or automatic standings releases
are granted. The trigger is an audit label, not an authorization bypass.

The automatic Node handoff also checks archive availability for non-exempt
transitions, including matching sport, year, old league and metadata. The scheduled
workflow still publishes archives before activation. For 2027 to 2028 and later,
the existing championship archive path remains mandatory. Missing/conflicting
archives block that sport. A Git push failure stops activation; a committed handoff
followed by connection loss is resolved with the identical-capture retry.

Standings remain unchanged until Doug separately previews and approves
`release-renewed-standings.mjs preview-initial SPORT` / `apply-initial SPORT`.
That existing command requires a reason and exact approval hash. Do not use the
normal archived-season release for pre-launch results. No new Fantrax leagues
are created by this implementation.

## Validation and next steps

Local checks performed: 24 Python tests, archive-gate tests across all five sports,
and PGlite migration/renewal tests including inaugural audit, transaction rollback,
retained standings, duplicate retry and MLB exclusion. These are offline checks,
not hosted or multi-session PostgreSQL tests. Docker is unavailable locally.

After transferring changes to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
PYTHONPATH=scripts python -m unittest test_archive_renewed_sports test_championship_calendar test_yearly_renewals test_fetch_update_modes
node supabase/tests/renewal-archive-gate.test.mjs
node supabase/tests/yearly-renewal.test.mjs
cd supabase/tests
npx --yes pnpm@11.25.0 test:mlb-docker
```

The Docker command reruns the existing nine observed-lock races against all current
migrations. Those races validate the shared handoff locking; they are not four new
sport-specific hosted rehearsals. Keep its output and stop on any failure.

Then inspect, without applying:

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Expected new migration: `202610220001_initial_roster_audit.sql`. Review before
applying to the test project. No production deployment is authorized by this file.
Once applied and once a real new Fantrax league exists, capture and preview it
before attempting hosted activation. Do not invent league IDs or create duplicate
leagues just to run the live test. Verify the transition log exemption and that
standings still point to the old league before separately approving their release.
