# Restore an actual encrypted R2 backup in Codespaces

The runner uses `supabase/postgres:17.6.1.136` (the pinned image in Supabase's official Docker Compose configuration when implemented). It bypasses platform initialization and creates a fresh database with no network access, published ports, Auth server or email worker. Cron execution is disabled. The image must supply every exact extension version in the backup, or the runner stops. It uses the container's own pg_restore, not host PostgreSQL tools.

Source: https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml

After transferring the reviewed files into Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
node supabase/tests/backup-real-guards.test.mjs
read -rsp 'Original backup encryption key: ' BACKUP_ENCRYPTION_KEY
printf '\n'
export BACKUP_ENCRYPTION_KEY
node supabase/tests/restore-real-backup.mjs \
  /workspaces/backup-rehearsal/checkpoint-rehearsal.pcbackup
unset BACKUP_ENCRYPTION_KEY
```

Use the existing key, not a new one. Docker must be running; no hosted database URI, R2 credentials, migration, or production setting is needed. The initial image download may take several minutes.

Success reports `restored: true`, table count, total row count and `checkpoint_count: 3` for this rehearsal export. Every exported table's row count and content hash must match. The runner removes its disposable container, anonymous volumes and decrypted temporary dump after success or failure. The original encrypted file remains. If Docker cleanup fails, run the specific removal command it prints; do not publish this database through Codespaces ports. Retry creates a new empty container.

A missing extension/version is a failed prerequisite, not permission to skip it. Share only the stage and fixed error code. No raw SQL errors or restored account data are printed. The runner is not a full Supabase platform clone: Auth login, role ownership/equivalence, platform secrets, Storage files and hosted recovery still require their own recovery validation. It restores grants but does not certify every role's effective permission behavior.

Local validation: offline guards and existing backup suite. Actual Docker/image compatibility and real-data restore must be validated in Codespaces; neither was run on the Windows development machine.
