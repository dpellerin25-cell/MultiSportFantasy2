# Production email rollout for the existing project

Prepared locally only. No hosted settings, notifications or recipients have been changed. The project is `tgvuntuhdqucazpoxrrg`. Owner invitation/password-reset emails are separate from this trade/overage queue.

## Safety and behavior

- Live delivery requires `TRADE_EMAIL_MODE=live` AND `TRADE_EMAIL_LIVE_CONFIRM=LIVE_EMAIL:tgvuntuhdqucazpoxrrg`. Scheduled sends additionally require `TRADE_EMAIL_ENABLED=true` and a Resend key. No setting is enabled by the migration.
- The sender remains `Pentagon Cup <notifications@multisportfantasy.com>`, with no Reply-To header. This does not technically prevent recipients replying; the email asks them not to reply.
- Only verified, currently linked eligible recipients are delivered to. Preview output includes owner slugs and notification/trade IDs, never recipient email addresses, bodies or private trade messages.
- `manage-notifications.mjs --preview` inventories ALL notifications, including sent, held, future-attempt and cutoff-excluded records. This is different from the delivery worker's eligible-queue preview.
- A known HTTP-test marker is a clue, not a complete fixture classifier. Doug must choose the obsolete records. There is no delete-all or automatic date-based suppression operation.
- Cleanup preserves notification rows, frozen payloads, attempts, provider receipts and trade history. It adds an immutable, private suppression record with reason, prior status, approving Doug account and approval hash. It marks selected records failed/held indefinitely. The worker also excludes suppressed IDs even if they are accidentally requeued.
- Only pending/failed records without sent timestamps or provider receipts can be suppressed. Sending records require investigation. Failed attempts may already have reached the provider; suppression cannot recall email. Review Resend before deciding to stop retries.
- Cleanup shares the delivery-worker lock. A changed selected record invalidates approval. Identical file/hash retries are idempotent, including after uncertain commit results. No cleanup code can call Resend.
- Existing frozen payload/idempotency keys remain unchanged. A frozen test email is held if the worker changes to live mode (and vice versa). Do not reset attempts, payloads or first-attempt timestamps to force a resend.

## 1. Keep sending disabled; test and review migration

In GitHub repository Variables, keep `TRADE_EMAIL_ENABLED=false`. Do not set the live confirmation yet. Transfer the reviewed files into Codespaces, then:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:email-production
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review `202611030003_notification_suppression.sql` and any other pending migrations. When ready, apply only after reviewing that list:

```bash
npx supabase db push --linked
```

Apply the migration before deploying the new delivery worker; the worker requires its suppression table and fails closed if it is absent.

## 2. Read-only queue inventory

Use the current project's direct/session-pooler database URI on port 5432. This administrative runner needs no owner passwords, Fantrax cookie or Resend key.

```bash
cd /workspaces/MultiSportFantasy2
export TRADE_ROSTER_PROJECT_REF=tgvuntuhdqucazpoxrrg
export NOTIFICATION_ADMIN_CONFIRM=tgvuntuhdqucazpoxrrg
read -rsp 'Database connection URI: ' TRADE_ROSTER_DATABASE_URL
printf '\n'
export TRADE_ROSTER_DATABASE_URL
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
node supabase/tests/manage-notifications.mjs --preview
```

Share the preview for review if needed. Do not share credentials. Compare notification/trade IDs, owner, dates, attempts, fixture marker and trade status. Sent messages are historical and should stay intact. Unlinked owners need correct account invitations separately.

## 3. Explicit suppression plan

Create `/workspaces/notification-cleanup.json` containing only the notification IDs you have reviewed:

```json
{
  "notification_ids": ["REPLACE_WITH_A_NOTIFICATION_UUID_FROM_PREVIEW"],
  "reason": "Doug reviewed these messages and confirmed they are obsolete rehearsal notifications."
}
```

Preview the chosen records (no writes):

```bash
node supabase/tests/manage-notifications.mjs --plan /workspaces/notification-cleanup.json
```

Review the selected records, count and `approval_hash`. To apply that reviewed plan:

```bash
node supabase/tests/manage-notifications.mjs --suppress /workspaces/notification-cleanup.json PASTE_APPROVAL_HASH
```

Repeat the identical command once to confirm `already_applied: true`. Run `--preview` again to confirm the selected rows are suppressed and sent records remain. A stale hash requires a new preview; never bypass it. Reason text is stored privately but should not contain credentials.

## 4. Configure and preview production delivery

Only after queue review, set the following GitHub repository Variables. Keep the enabled switch false while reviewing:

| Variable | Value |
|---|---|
| `TRADE_ROSTER_PROJECT_REF` | `tgvuntuhdqucazpoxrrg` |
| `TRADE_EMAIL_ENABLED` | `false` until the final delivery step |
| `TRADE_EMAIL_MODE` | `live` |
| `TRADE_EMAIL_LIVE_CONFIRM` | `LIVE_EMAIL:tgvuntuhdqucazpoxrrg` |
| `TRADE_EMAIL_NOT_BEFORE` | Explicit UTC ISO activation cutoff, e.g. `2026-11-04T15:00:00Z`; choose the actual intended cutoff, do not blindly use this example |
| `TRADE_EMAIL_SITE_URL` | Your verified live HTTPS website origin on your domain, without a path |

Keep existing Secrets `TRADE_ROSTER_DATABASE_URL`, `TRADE_ROSTER_CA_CERT` (full PEM text, not a path), and `RESEND_API_KEY`. `TRADE_EMAIL_TEST_RECIPIENT` is used only in test mode. Do not expose these values in reports.

The cutoff filters by event/alert creation time, not execution time. Messages older than it cannot send; they remain in the inventory. Review genuine offers/alerts before choosing the cutoff, since it can also exclude legitimate older messages. If an owner already has an ongoing overage alert older than the cutoff, a new warning may not be generated until that violation clears and a new one opens; review and notify as appropriate instead of silently assuming it will resend.

Run GitHub **Send Trade Notifications → Run workflow → preview**. It works while delivery is disabled. Inspect eligible and held counts. A zero count is not proof of email delivery.

## 5. Controlled delivery, only when explicitly ready

First use test mode with a verified linked test recipient and a newly approved notification after the cutoff; review the queue first. Test mode filters to that account and does not redirect other owners' emails. Enable delivery only when ready to send that controlled test, then confirm its receipt in Resend and the inbox. Remember that enabling also enables the five-minute schedule. Disable again before changing recipient mode.

After this test, suppress obsolete remaining test notifications with the reviewed process. Restore live mode and its explicit confirmation, preview again, and only then set `TRADE_EMAIL_ENABLED=true`. The next five-minute run may send ALL eligible approved recipients, not just Doug. Frozen test payloads will remain held rather than be converted into live mail.

Emergency stop: set `TRADE_EMAIL_ENABLED=false`; this stops future jobs, not a request already in flight. Do not remove suppression history or reset notification IDs.

## Validation scope

Offline tests load all real migrations into PGlite and use a fake provider. They cover private/read-only previews, stale approvals, rollback after audit insertion, immutable suppression records, retries, sent preservation, suppressed requeue exclusion, explicit live targeting, test/live payload separation, recipient verification, provider failure/crash retries and duplicate-send keys. No emails are sent.

Hosted queue validation, actual PostgreSQL multi-session cleanup/delivery contention, Resend delivery and GitHub/Vercel settings are not verified by these offline tests. Production build is not needed for this server-script/migration-only change. Existing hosted fixture test target restrictions remain unchanged.
