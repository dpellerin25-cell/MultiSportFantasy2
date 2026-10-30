# 80-player policy rollout

Approved October 29, 2026: combined roster cap **80**, startup **80 rounds per owner**,
annual rookie/free-agent draft **10 rounds**. Eleven owners means 880 startup picks.
All rostered players count, including IR and minors; picks do not. No sport minimums
or maximums were added. Starting-lineup slots and placement/dominance formulas are unchanged.

## Effective time and history

`web/data/roster-policy.json` supplies the current website and Node-tool values.
Migration `202610290001_roster_policy_80.sql` installs the matching immutable database
policy. Tests verify parity. New SQL migrations are necessary for future policy changes;
editing the JSON alone is not sufficient. Draft setup and email delivery reject a
database/code policy mismatch.

The policy becomes effective at the timestamp recorded during deployment, once the
migration commits. It is not backdated to midnight October 29. Therefore a 4 a.m.
check before deployment keeps 65; a check after deployment uses 80. This implements
immediate activation without retroactively changing historical scoring. A later correction
to an old count still uses that check's historical policy, not the correction date.

Historical checks use the cap at their **4 a.m. America/New_York** instant. After migration 202610300001, new scheduled observations use actual fetch completion time. PGA can span
the effective date: each Thursday/Sunday check uses its own applicable cap, and both
must be over to penalize. Only positive starters are removed; negative starters remain.
Count evidence, score revisions, decisions, pause events and PGA resolutions are not rewritten.
Missing evidence remains pending. Published standings and Fantrax imports are unchanged.

The constitution previously said all points on the check day were forfeited. This
conflicted with the agreed previous-day/positive-only rule and PGA exception; it now
states those agreed rules. Its separate statement that there are currently no IR
slots remains unchanged: if IR/minor players exist, they still count toward 80.

## Existing state needing review

No hosted state was inspected or changed during implementation.

- Open alerts for 66–80 players are closed. Unsent obsolete warnings are held.
- Sent messages, provider receipts and frozen payloads are retained. Alerts and their
  prior notification rows are recorded in `trading.roster_policy_cleanup`.
- Previously attempted, uncertain overage deliveries are held for review rather than
  resent with a different message. Do not manually reset them to pending without
  checking the provider receipt; that could duplicate a delivery.
- Still-over-cap, never-attempted warnings use the new template. Continuous violations
  retain the existing unique alert/recipient identity.
- Existing startup drafts retain their rounds, picks and selections. Started, cancelled,
  retired or pick-bearing drafts cannot use the transition operation. An old setup draft
  cannot start until explicitly transitioned or replaced by a new setup draft.
- The transition only changes rounds/revision on a setup draft with no clock, slots or
  selections and enough eligible pool players. It records prior state and approval.
  A same-hash retry succeeds without another event; a changed/stale hash is rejected.

## 1. Transfer files, then test in Codespaces

These changes were not committed or pushed. Transfer the tested working files through
your normal reviewed Git workflow first, then in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test
npx --yes pnpm@11.25.0 test:roster-policy
npx --yes pnpm@11.25.0 test:scoring-import
npx --yes pnpm@11.25.0 test:scoring-confirmations
npx --yes pnpm@11.25.0 test:roster-policy-concurrency
npx --yes pnpm@11.25.0 test:membership-concurrency
cd ../../web
npm ci
node tests/trades.test.mjs
npm run build
```

`test:roster-policy-concurrency` creates a disposable loopback PostgreSQL container.
It runs the ten scoring races at the 80/81 boundary with a **synthetic** effective date
inside that disposable database. The normal scoring runner retains historical 65/66
fixtures. The membership runner now exercises 80-round setup/start locking. Neither
runner contacts Supabase or Fantrax. Keep their output and use only their exact printed
container cleanup commands after inspection.

## 2. Apply to the test Supabase project only

Before rollout, pause email delivery (`TRADE_EMAIL_ENABLED=false`) and let any in-flight
worker finish. This prevents an older deployed worker from rendering the old wording.
Coordinate migrations and the new website/worker version before enabling delivery again.

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Expect only:

- `202610290001_roster_policy_80.sql`
- `202610290002_startup_transition.sql`

If unexpected migrations appear, review them before proceeding. After approving this
test-project preview:

```bash
npx supabase db push --linked
npx supabase migration list --linked
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
cd supabase/tests
node scoring-hosted.test.mjs
node transition-startup-80.mjs --list
```

Use your existing private `DRAFT_TEST_DATABASE_URL` and hosted test account settings.
Do not paste passwords into chat. The hosted scoring runner rolls back fixtures; it
checks real permissions with historical evidence, not the new cap's concurrent behavior.
The disposable cap tests above provide boundary coverage.

In the test project's SQL editor, inspect without changing data:

```sql
select * from draft.roster_policy_versions order by effective_at;
select draft.roster_cap_at(clock_timestamp()) as current_cap;
select count(*) as obsolete_open_alerts
from trading.roster_limit_alerts
where resolved_at is null and player_count <= 80;
select count(*) as preserved_cleanup_records from trading.roster_policy_cleanup;
select id, status, last_error, first_attempt_at
from trading.notifications
where last_error = 'roster_policy_80_obsolete_or_delivery_review';
```

Expect current cap 80 and zero obsolete open alerts. Each policy environment has its
own activation timestamp; preserve it as rollout evidence. Migration execution is
transactional; a failed migration rolls back. A normal repeat `db push` skips migrations
already applied. Do not manually rerun an applied migration SQL file.

## 3. Review any unstarted draft

Replace `DRAFT_UUID` with one ID from `--list`:

```bash
node transition-startup-80.mjs --preview DRAFT_UUID
```

If there are blockers, leave that draft unchanged. Retired rehearsals need no action.
For an eligible setup draft only, after reviewing the displayed settings and hash:

```bash
node transition-startup-80.mjs --apply DRAFT_UUID APPROVAL_HASH
node transition-startup-80.mjs --apply DRAFT_UUID APPROVAL_HASH
```

The second call must report `already_applied: true`. The administrative CLI is guarded
to the test project. Do not weaken its guard to target production. Production uses the
same reviewed SQL functions through a privileged, explicit administrative operation.
No startup order is invented and no draft is started by this process.

## 4. Validate website and notifications, then plan production

Run the website against the test project. Check roster count displays, trade projections
(80: no warning; 81: warning without blocking), constitution, settings preview and an
80-round startup preview (880 for eleven owners). Confirm the annual draft remains 10.
Check the next actual scheduled roster count preserves observed counts and uses the
policy appropriate to its actual scheduled observation time (legacy checkpoints retain 4 a.m.). Do not fabricate historical checks.

Preview the email queue using the existing email workflow's **preview** mode. This
does not send messages. Confirm obsolete warnings are held and current warnings say 80.
Do not resend held uncertain deliveries simply to test this change.

Only after these checks pass, separately approve production rollout: back up the database,
pause its email worker, review its migration dry-run and existing drafts, apply the same
migrations, deploy matching code, verify policy/settings/alerts, and restore email delivery.
No production or hosted changes were performed as part of this implementation.
