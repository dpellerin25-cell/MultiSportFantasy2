# Daily Fantrax roster and trade sync

The existing **Update Fantrax Data** workflow now optionally imports the five
fresh roster files into the selected Supabase trade database after publishing
the website's roster files. Standings-only runs never perform this import.
The existing schedules are unchanged: daily rosters at 09:00 UTC and standings
on Tuesdays at 04:00 America/New_York.

## Enable on the TEST project first

No hosted changes or credentials have been configured by this implementation.
Transfer the tested code to GitHub when ready. The destination must already have
the trade and league-membership migrations, plus the new batch-import migration
`202610040002_trade_roster_batch.sql`. The separate unrestricted-startup migration
is unrelated to the sync, but may also appear as pending from the prior task.

From Codespaces, after transferring the files:

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the pending migrations, then apply them to TEST with
`npx supabase db push --linked`. Do this before enabling the workflow connection.

In the repository, open **Settings → Secrets and variables → Actions**.

Add these **Variables**:

| Name | Initial value |
| --- | --- |
| `TRADE_ROSTER_PROJECT_REF` | `tgvuntuhdqucazpoxrrg` |
| `TRADE_ROSTER_SYNC_ENABLED` | `true` after the secrets below are ready |

Add these **Secrets**:

| Name | Value |
| --- | --- |
| `TRADE_ROSTER_DATABASE_URL` | TEST project's PostgreSQL session-pooler connection URI, port 5432, database `postgres`, including its database password, without query parameters. Get the actual hostname from Supabase Connect. |
| `TRADE_ROSTER_CA_CERT` | Optional PEM text of the trusted Supabase CA certificate. Use the same certificate that made the Codespaces connection work if the normal trust store cannot validate the chain. Paste the file contents, not its path. |

`FANTRAX_COOKIE` remains the existing GitHub secret used to fetch rosters. No
owner email/password, publishable key, or browser service-role key is needed.
The database URI is a privileged server-only credential: keep it exclusively in
Actions secrets, never in repository files or `NEXT_PUBLIC_*` variables.

Example URI shape (not a real hostname/password):

```text
postgresql://postgres.tgvuntuhdqucazpoxrrg:ENCODED_DATABASE_PASSWORD@aws-0-YOUR-REGION.pooler.supabase.com:5432/postgres
```

Use the exact hostname supplied by Supabase; URL-encode password symbols. The
session pooler avoids direct-connection IPv6 requirements on hosted runners.
Direct project URIs are also accepted. TLS verification is always enabled;
an optional CA is added to Node's trusted store, never used to bypass validation.

## First hosted check

1. Make sure `web/data/league-settings.json` matches the test database's active
   owners and the Fantrax owner names. Do not enable against unrelated fixtures.
2. In **Actions → Update Fantrax Data → Run workflow**, select `rosters`.
3. Confirm the fetch, data commit, and **Sync fresh rosters and reconcile accepted
   trades** steps pass. The last step prints the project, per-sport counts and
   observation times, and the number of trades newly completed.
4. Check the roster page connected to that same test database. For an accepted
   player trade, manually make the agreed transfers in Fantrax first, then run
   the roster workflow again. It should complete/archive the trade only when
   every involved player is on the agreed team. Without matching transfers it
   remains accepted. Do not create real transfers merely to manufacture a test.
5. Confirm a standings-only workflow run skips all trade-import steps.

The daily schedule uses the same path once enabled. To disable database sync,
set `TRADE_ROSTER_SYNC_ENABLED` to `false`; public roster refreshes continue.
Production cutover requires explicitly replacing BOTH the project variable and
database secret with the production destination after its migrations, membership
and data are ready. Never point the test website at a production import by accident.

## Guarantees and limits

- All five files are validated before connecting: expected leagues/sports,
  approved owners, exact counts, stable IDs, no duplicate players, and valid
  fetch timestamps no older than six hours. Older saved files without
  `fetch_started_at` must be fetched again.
- Unexpected roster envelopes are rejected rather than treated as empty teams.
  Real empty rosters represented by empty rows/slots are allowed.
- Observations use each sport's **fetch start**, not file-write time. A trade
  accepted during that sport's reads waits for a later fetch before completion.
- The private batch importer runs for all five sports in ONE transaction
  under the same lock as trade acceptance/membership changes. A later-sport
  failure rolls back all five imports, trade completions and reservation changes.
  Reconciliation waits until all five are loaded, so a mix of old and new sport
  snapshots cannot prematurely complete a trade during the batch.
- An identical retry is harmless. Older/conflicting snapshots or mismatched
  active membership are rejected. Existing reconciliation handles manual
  corrections as well as normal transfers; no Fantrax writes are performed.
- Public file publication and the database cannot share a transaction. Files
  are published first so database connection failure does not stop the public
  refresh. The Actions run fails visibly if an enabled sync fails. Correct the
  problem and run `rosters` again; it fetches new data and safely catches up.
- A lost connection during commit can leave the outcome uncertain; retry to
  confirm, rather than assuming rollback. No per-player or secret values are
  printed in errors. GitHub's workflow failure notifications provide the alert.
- Reads across five leagues are sequential, not an atomic Fantrax snapshot.
  Trade emails remain a separate feature; this does not deliver email.

## Local verification

```bash
cd supabase/tests
node trade-roster-sync.test.mjs
```

The offline tests exercise strict target/TLS settings, fresh-file validation,
empty rosters, cross-sport IDs, retries, all-or-nothing rollback, acceptance
during a fetch, completion, stale rejection, and audit deduplication. They use
in-memory PostgreSQL and do not contact Supabase or Fantrax.

After a fresh Fantrax fetch, an optional read-only preview is:

```bash
node sync-trade-rosters.mjs --preview
```

The existing `import-trade-rosters.mjs` remains the explicitly test-only manual
saved-file tool. Automation uses `sync-trade-rosters.mjs` with its stricter
freshness checks and explicitly selected target instead.
