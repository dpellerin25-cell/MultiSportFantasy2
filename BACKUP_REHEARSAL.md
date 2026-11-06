# Hosted checkpoint upload rehearsal

This targeted rehearsal creates a separate, synthetic two-owner draft. It creates start, completed-round (two skipped slots), and terminal checkpoints inside one transaction, committing only the cancelled draft. It makes no selections, roster changes, account grants, or changes to the actual startup draft. Its audit records remain available. No migration is required.

After these files are available in Codespaces, run from the repository root:

```bash
cd /workspaces/MultiSportFantasy2
node supabase/tests/backup-rehearsal.test.mjs
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
node supabase/tests/rehearse-backup-checkpoints.mjs --create
```

The existing `DRAFT_TEST_DATABASE_URL` must be set privately in this terminal. If missing, use:

```bash
read -rsp 'Database connection URI: ' DRAFT_TEST_DATABASE_URL
printf '\n'
export DRAFT_TEST_DATABASE_URL
```

Expected: `status: cancelled`, three checkpoints, and initially `all_uploaded: false`. Repeating `--create` preserves the same fixture and returns `already_created: true`. After a connection failure, run `--status` before retrying.

In GitHub Actions, open **Encrypted league backups**, choose **Run workflow**, and select mode **drafts**. This processes all pending draft checkpoints, including this rehearsal. `BACKUPS_ENABLED` must already be true. Manual dispatch does not require enabling `DRAFT_BACKUPS_ENABLED`.

After the workflow succeeds:

```bash
node supabase/tests/rehearse-backup-checkpoints.mjs --status
```

Require three receipt records, nonempty `object_key`, `sha256`, and `uploaded_at`, and `all_uploaded: true`. Check that the exact returned object key exists in your R2 bucket. Because this rehearsal is cancelled, its backup is classified as **final**; it need not appear under a draft prefix. Multiple checkpoints can share one full backup object. The exporter verifies the uploaded object's bytes before recording receipts. Final backups are retained by the existing retention policy.

Run the workflow in **drafts** mode again. With no other pending checkpoints, it should report no pending uploads and create no duplicate receipt records.

This verifies hosted checkpoint capture and encrypted R2 upload/readback. It does not replace a restore drill or test owners making picks through the website. Do not start the real startup draft for this check.
