# Import a validated Fantrax export into the TEST database

Only `MultiSportFantasy-Draft-Test` (`tgvuntuhdqucazpoxrrg`) is accepted by
the CLI. No production deployment, roster updates, draft creation, or Fantrax
requests. Database credentials and the existing certificate configuration are
used; Auth account passwords and publishable keys are not needed for this import.

## Transfer and validate

Transfer the new importer, tests, documentation, migration and updated fixture
files through your normal GitHub/Codespaces process. Do not include environment
files, credentials, downloaded exports, certificates or Python cache directories.
No commit or push was performed by the implementation task.

In Codespaces, after updating the checkout:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test
node import-player-pool.mjs --validate-only /tmp/fantrax-player-pool.json
```

Use the full export from `scripts/export_player_pool.py`, not the diagnostic
summary/sample files. Adjust the path if needed. This validation command does
not connect to Supabase. Counts must match the file, not a hard-coded historical
19,507 total. New exports may have different counts. Export timestamps are
printed so the commissioner can choose an appropriately recent snapshot.

## Apply the new guard migration to TEST only

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the dry run. With the first three migrations already applied, only
`202609250001_import_snapshot_guards.sql` should be pending. If the target or
pending migrations differ, stop and investigate. Then:

```bash
npx supabase db push --linked
```

The migration prevents edits, removal or reopening of any ready import, and
prevents entry insert/update/delete unless its parent is staging. Entry changes
and finalization lock the same parent row. Existing ready imports stay intact.
Existing test fixture builders now create staging imports, populate entries,
then finalize before starting their simulated draft. No constraints are relaxed.

## Import

Use the same terminal with your corrected `DRAFT_TEST_DATABASE_URL`. If absent,
enter it privately again using the hidden prompt in HOSTED_VALIDATION.md.

```bash
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
cd /workspaces/MultiSportFantasy2/supabase/tests
NODE_EXTRA_CA_CERTS=/tmp/supabase-test-ca.crt \
  node import-player-pool.mjs --import /tmp/fantrax-player-pool.json
```

Use your actual certificate path. TLS certificate and hostname verification stay
enabled. Output contains the committed import UUID, sport counts, total and one
database-read sample per sport. A retry of the exact file returns
`already_imported: true`. Save the import UUID for future draft setup. This step
does not create a draft or select its pool automatically.

## Storage and safety

- SHA-256 of exact file bytes identifies retries. Reformatting a file produces
  a separate snapshot, but not duplicate player identities.
- Every file is checked before connecting: five expected league mappings,
  source/schema, timestamps, complete flags, effective availability/position
  filters, pagination counts, no duplicate league/player IDs, known FA/waiver
  status, and per-sport count reconciliation. Numeric IDs are rejected so
  leading zeroes cannot be lost. PGA may have null position/team.
- Import metadata and player fields are whitelisted. Arbitrary extra fields
  and raw response payloads are not copied into the database.
- One transaction stages, resolves identities, inserts entries, verifies counts
  and marks ready. Failures roll back everything. An advisory transaction lock
  serializes importer runs; source uniqueness also protects conflicting inserts.
- Existing player UUIDs are reused by `(fantrax, league_id, player_id)`. A sport
  mismatch aborts. Existing canonical player details are left intact; each new
  snapshot stores its current name, position, team and availability. Drafts must
  read snapshot details rather than assuming the canonical row is the latest.
- Snapshot metadata is provenance, not cryptographic proof of Fantrax results.
  This trusted administrative importer relies on the verified export collector.
  It does not re-fetch pages or perform live roster verification. Reads across
  sports remain sequential. SQL administrators remain trusted.
- The migration does not validate arbitrary administrator-written ready imports;
  only this importer supplies the file validation workflow. No client permissions
  or new SECURITY DEFINER functions are granted.

## Validation performed locally

Existing schema, command and hosted-offline suites plus the importer suite:
invalid input rejection; stable IDs; same-file retries; five-sport import;
new snapshots without overwriting history; leading-zero and cross-league IDs;
immutable snapshots; injected mid-import failure rollback; no draft creation.
No hosted import or new multi-session test was run locally. The fixture change
in the existing concurrency runner should be checked against a fresh disposable
local PostgreSQL database in Codespaces, following COMMANDS.md—not hosted.
