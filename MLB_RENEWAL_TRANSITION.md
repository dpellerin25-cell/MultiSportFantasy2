# Controlled MLB renewal — not activated

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
