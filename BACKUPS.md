# Encrypted backups and recovery

Built locally; schedules and hosted settings have not been enabled. No real data or secrets were read and no R2 uploads occurred during development.

## What is saved

The exporter uses a consistent PostgreSQL snapshot shared by `pg_dump` and a table-content manifest. It exports schema, rows, sequences, functions, grants and RLS policies in `draft`, `trading`, `scoring`, `backup`, `public`, `auth` and `supabase_migrations`. This includes owner account links, Auth database records, prospects, traded picks, scoring corrections and immutable history. Every table has a row count/content checksum. Role metadata/membership and extension requirements are included for recovery review; role passwords are not exported.

Each package contains a compressed PostgreSQL custom-format dump and its manifest, encrypted with AES-256-GCM using a random nonce and a private 32-byte key. A wrong key or altered ciphertext fails authentication. The file's SHA-256 is verified by downloading it after upload. Objects use unique names and conditional creation; no daily file is overwritten.

These are database exports, not a complete Supabase platform clone. Storage API file bytes, environment variables, Auth/SMTP/redirect configuration, project/API secrets, role passwords, external cron setup and schemas outside the allowlist are not included. Keep hosting settings and the Git commit/migrations recorded separately. If Supabase Storage is used for uploads, those objects need their own backup process. Hosted restoration requires matching platform/extension versions and explicit Auth/config/role verification; the local restore tool is deliberately restricted to disposable databases.

## Timing and retention

- Daily full application/database export: **3:45 a.m. America/New_York**, after the planned data refreshes. Actual GitHub execution can be delayed.
- Before drafting or a major migration: manual export, retained indefinitely.
- Round completion: the database saves a cumulative checkpoint transactionally, including skipped picks, current ownership, selection history, command/events and selected-player details. A start checkpoint, undo/makeup corrections and terminal checkpoint are also recorded. It never calls an external service from the pick transaction.
- During drafting only, a five-minute worker uploads pending checkpoints with a full consistent database dump. Several checkpoints may share one export per draft. The full dump reflects export time (possibly later than the round); exact queued round snapshots are included separately. No claim is made that upload completes instantly when a round ends. A database failure before upload can lose the pending checkpoints. GitHub scheduling is not a zero-data-loss service.
- Full round exports cost more storage than draft JSON alone, but make each uploaded package independently recoverable. The loop retries pending checkpoints; acknowledgement occurs only after upload/read-back verification. A crash between upload and acknowledgement can create an extra valid object, not lose a checkpoint.
- Keep the newest backup for **14 daily dates**, plus one per each of the **latest eight available weeks** (up to 22 distinct daily objects). Retain manual/final exports indefinitely. Keep draft exports until a matching draft's final export exists and is 30 days old. Active drafts and missing final exports are retained indefinitely. A cancelled draft also creates a terminal recovery copy.
- Deletion affects only the exact managed object namespace/naming format. Retention defaults to preview. Automatic retention requires a separate enable switch and runs only after a successful daily upload. Failed uploads never trigger retention.
- Database checkpoint/audit rows are retained; R2 retention does not delete database history.

## Offline tests first

After transferring reviewed files to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:backup
npx --yes pnpm@11.25.0 test:backup-docker
```

The first runs locally in PGlite with synthetic fixtures and mocked object storage. The second uses Docker PostgreSQL 17, all actual migrations and synthetic account/pick data. It performs real `pg_dump`, encryption, decryption, `pg_restore`, table checksum comparison and refusal to restore into the now-nonempty target. It uses the container's version-matched utilities; no host PostgreSQL installation is required. It leaves only the disposable container for inspection and prints its specific removal command. It never connects to Supabase or R2.

Local development passed offline encryption/retention/checkpoint tests and existing draft timer tests. Docker is unavailable in the development environment: **the full PostgreSQL restore rehearsal still needs to pass in Codespaces**. A synthetic restore is not proof a hosted Supabase Auth restore works; test an actual encrypted export separately before relying on this for launch.

## Encryption key and settings

Generate a fresh key in a trusted terminal:

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
```

Store it as GitHub **repository secret** `BACKUP_ENCRYPTION_KEY` and keep a separate offline/password-manager copy. Do not paste it into chat or commit it. Without it, backups cannot be decrypted. Preserve old keys when rotating; retained files require the key used at creation.

Existing repository secrets used: `TRADE_ROSTER_DATABASE_URL`, `TRADE_ROSTER_CA_CERT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The CA secret contains complete PEM text. TLS certificate verification stays enabled. R2 credentials must be restricted to the private `pentagon-cup-backups` bucket. Disable public bucket access. Standard storage is intended.

Repository variables:

| Variable | Initial value |
|---|---|
| `BACKUP_PROJECT_CONFIRM` | `tgvuntuhdqucazpoxrrg` |
| `TRADE_ROSTER_PROJECT_REF` | `tgvuntuhdqucazpoxrrg` |
| `R2_BUCKET` | `pentagon-cup-backups` |
| `R2_ENDPOINT` | Cloudflare S3 endpoint for this account |
| `BACKUPS_ENABLED` | `false` until offline tests and migration review pass |
| `DRAFT_BACKUPS_ENABLED` | `false`; enable during drafts only |
| `BACKUP_RETENTION_ENABLED` | `false` until the deletion preview is reviewed |

The five-minute jobs are skipped unless draft backup polling is enabled; do not run this polling all year unnecessarily. GitHub runner usage can have its own limits/costs, independent of R2.

## First hosted export (when ready)

1. Run the tests above. Review `202611040001_backup_checkpoints.sql` with `supabase db push --linked --dry-run`, then apply to the confirmed current project when ready. This adds private checkpoint/receipt tables and a deferred draft trigger. It does not enable schedules or send emails.
2. Configure the key and variables. Set `BACKUPS_ENABLED=true` only when ready: this permits both manual runs and daily scheduling. Leave draft polling/retention false initially.
3. Run **Encrypted league backups → preview**. This reads database size and pending checkpoint count without exporting/uploading.
4. Run **manual**. Check the log's encrypted/dump byte sizes and confirmed uploaded key. This first manual copy is retained indefinitely. It includes sensitive Auth data only inside authenticated encryption; there are no plaintext GitHub artifacts.
5. Download the `.pcbackup` object privately from R2. Perform an actual restore rehearsal in an isolated environment before calling backup/recovery verified. The current local tool supports only an empty loopback database named `pentagon_restore_*` and never hosted targets.
6. Run **retention-preview**. Review exact proposed deletions, then enable `BACKUP_RETENTION_ENABLED=true` if the policy is suitable.
7. Verify a successful daily job/object the next day. Enable GitHub Actions failure notifications. Missing runs do not produce a failure notification, so also check that the newest daily object is under 48 hours old; independent dead-man monitoring is not implemented.

PostgreSQL client 17 is installed by the workflow. If the hosted database is newer, upgrade that client before export; `pg_dump` fails rather than create an incompatible backup. The 512 MiB compressed-dump guard also fails closed and requires a streaming exporter review if reached.

## Restore procedure

Never restore onto the current league as a test. First stop delivery, scoring, roster/renewal jobs and draft timers in the recovery environment. Never copy production API/email credentials into the rehearsal environment.

For the synthetic end-to-end test use `test:backup-docker` above. For an actual encrypted export, prepare a **fresh isolated PostgreSQL/Supabase-compatible instance**, with the required extension versions listed in the backup manifest and matching PostgreSQL major version. Install version-matched `pg_restore` locally. Then load the encryption key and a loopback disposable URI privately:

```bash
read -rsp 'Backup encryption key: ' BACKUP_ENCRYPTION_KEY; printf '\n'
export BACKUP_ENCRYPTION_KEY
read -rsp 'Disposable local restore URI: ' BACKUP_RESTORE_DATABASE_URL; printf '\n'
export BACKUP_RESTORE_DATABASE_URL
export BACKUP_RESTORE_CONFIRM=pentagon_restore_test
node supabase/tests/restore-backup.mjs /path/to/downloaded.pcbackup
```

The URI must be `postgresql://postgres:PASSWORD@127.0.0.1:PORT/pentagon_restore_test`. An ordinary PostgreSQL container may lack hosted Supabase extensions; a missing extension is a test failure, never silently skipped. A hosted Supabase target already contains managed `auth`/`public` objects and requires a separately reviewed managed-schema restore plan; do not point raw `pg_restore` at it.

To inspect only safe manifest metadata (version, extension requirements, table counts and sizes) after loading the encryption key, without any database access:

```bash
node supabase/tests/inspect-backup.mjs /path/to/downloaded.pcbackup
```

The restore runner decrypts/authenticates, rejects any nonempty target, creates non-login placeholder roles, restores extensions and dump, then compares every exported table's count/content checksum. It preserves database records but does not certify Auth sign-in, role owner equivalence, RLS behavior or external integrations. Those need explicit tests before switching the live website. Do not resume the copied draft clock or outbound workers until the commissioner approves recovery.

After a disaster: preserve the damaged project, restore separately, validate roles/accounts, draft selections, picks, trades, scoring and chronology, then explicitly approve website/workflow connection changes. Recover from the latest appropriate export, not automatically the latest file if that file contains the original bad change. Round JSON checkpoints are evidence of exact boundaries; using an older round rather than the full dump's state requires a reviewed administrative correction, not an automatic overwrite.

## Storage estimate

Let **D** be the measured encrypted database export size. Normal rolling retention costs at most about **22 × D**, plus permanent manual/final copies. During an 80-round draft, conservatively budget another **80 × D**, plus start/correction/final copies. Poll batching may reduce the number of full packages; corrections may increase it.

| Encrypted export D | Up to 22 regular copies | 80 round packages | Combined, before permanent/correction copies |
|---|---:|---:|---:|
| 10 MB | 220 MB | 800 MB | 1.02 GB |
| 50 MB | 1.10 GB | 4.00 GB | 5.10 GB |
| 100 MB | 2.20 GB | 8.00 GB | 10.20 GB |

These are scenarios, not measured production estimates. `--preview` reports raw database size; a completed export reports actual compressed/encrypted bytes. Raw database size includes indexes/free space and is not a reliable compressed export estimate. The retention report warns when this managed prefix exceeds 8 GB, but does not enforce an account-wide spending cap.

Storage is **not constant**: scoring/player imports and audit/checkpoint history grow, final/manual archives accumulate, and old active/unfinished draft copies remain protected. Review after the first export and before drafting. The first round run may include old unexported checkpoints, so inspect the queue before enabling it.

Cloudflare R2 Standard currently includes **10 GB-month storage**, **1 million Class A operations/month**, and **10 million Class B operations/month**. Egress is free. These allowances are account-wide, not per bucket; exceeding them can incur charges, rather than stop uploads. Keep total account storage comfortably below 10 GB if the goal is no storage charge. Infrequent Access does not get the Standard free allowance. Source: https://developers.cloudflare.com/r2/pricing/ (checked November 4, 2026).
