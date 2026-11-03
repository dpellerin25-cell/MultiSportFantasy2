# Production readiness audit — November 2, 2026

## Outcome

**Not certified for production.** Repository inspection and offline audit tests are complete. No hosted database was contacted, credentials read, workflow changed, account signed in, notification sent, migration applied, or data edited by this audit. User-reported successful live account tests are useful evidence, but not independent verification of database state.

## Verified in the repository

| Finding | Evidence |
|---|---|
| Approved configuration has 11 owners including Billy and John | `web/data/league-settings.json` |
| Current cap/startup/annual rules are 80/80/10 | `web/data/roster-policy.json`; additive versioned policy migration |
| Draft, trade, public-pick and account clients require the existing test project | `web/src/lib/draft-model.ts`, `web/src/components/Trades.tsx`, `web/src/lib/public-picks.ts`, `web/src/lib/league-settings-client.ts` |
| Trade notification live delivery requires explicit project approval | `supabase/tests/trade-email.mjs`: `TRADE_EMAIL_MODE=live` also requires `TRADE_EMAIL_LIVE_CONFIRM=LIVE_EMAIL:tgvuntuhdqucazpoxrrg`; delivery remains disabled until configured |
| Hosted validation utilities deliberately restrict their target | `supabase/tests/hosted-validation.mjs`; keep destructive/fixture test guards separate from future production configuration |
| Scoring publication is separate from standings | `SCHEDULED_SCORING.md`; publication defaults off and historical test sources cannot be published |
| Scoring collection uses approved season sources, not current roster ownership | Scheduled-scoring implementation/documentation; source configuration must be verified for all owners |
| Workflows are gated by repository variables | `.github/workflows/test-fantrax.yml`, `player-scoring.yml`, `trade-email.yml`, `yearly-renewals.yml` |
| Registry JSON is bootstrap data, not sufficient evidence of active leagues | `scripts/fantrax-connections.json` still contains old MLB; normal enabled workflow exports database overrides before fetch |

## Needs attention before production

1. **Prepare the present project for permanent use.** Explicit email targeting, read-only queue review and audited suppression are implemented locally; see `TRADE_EMAILS.md` for migration, cutoff and enablement steps. Hosted delivery is not yet approved or enabled by this work. Moving projects would still require updating website guards, runtime credentials/settings, migrations/state and Auth/account links. Existing test runners remain restricted.
2. **Inventory real versus rehearsal data.** Drafts/trades do not have a universally reliable test flag. The report exposes counts and draft IDs but deliberately does not classify fixtures from names. Doug must identify the real startup draft and any historical test activity. Preserve audit history and existing player/pick ownership; do not delete data merely to obtain a clean report.
3. **Review pending email queue before live delivery.** Confirm intended recipients and `TRADE_EMAIL_NOT_BEFORE`. Authentication SMTP success does not establish trade/overage delivery readiness.
4. **Approve actual championship scoring sources as leagues become available.** Future missing sources are a launch checklist item, not a reason to invent metadata. PGA needs verified periods. Missing player data stays pending. Connecting penalty-adjusted totals to published standings remains a separate task/approval.
5. **Confirm inaugural and later renewal behavior in the destination.** Export approved connections; preserve old-season scoring sources and separate standings release. Do not interpret pre-launch 2026 as Cup results. Do not overwrite the current database from bootstrap JSON.
6. **Prepare the real draft:** 80 rounds × final owner count (880 for 11), final order/timer, reviewed pool and all owner accounts linked. Old cancelled/retired 65-round rehearsals remain historical records.

## Not yet verified

- Applied hosted migration versions and SQL drift; version parity does not prove byte-identical SQL.
- Current account mappings, commissioner privileges and actual RLS/RPC behavior. Catalog RLS/grant inventory is not an authorization penetration test.
- Current backups, retention, recovery target and an isolated restore rehearsal.
- Vercel deployed commit, environment scoping and secret isolation; live domain/Auth redirects/SMTP configuration.
- GitHub variables/secrets, recent workflow execution, branch protection permitting archive commits, and enabled database timer/Realtime services.
- All current Fantrax leagues, scoring source team maps, lineup evidence, renewal freshness and completed-day reconciliation.
- Trade provenance, pending transfers, scoring decisions requiring attention, and league email delivery.
- Production standings connection approval and final league-wide rehearsal.

## Read-only audit runner

Files: `supabase/tests/production-audit.mjs`, `run-production-audit.mjs`, `production-audit.test.mjs`.

The runner targets **only** `tgvuntuhdqucazpoxrrg`. It uses the existing verified-TLS direct/session-pooler connection parser. It establishes default read-only sessions and an explicit repeatable-read/read-only transaction, verifies the read-only flag, executes fixed catalog/aggregate SELECTs, and rolls back. No application RPCs are called, including seemingly read-like helpers that might mutate state. Each query has a savepoint and timeouts; a missing table/permission becomes **not_yet_verified**, not a pass. Connection failures emit no raw error or URL.

Output contains owner slugs, draft IDs, league IDs, statuses, dates and counts. It omits emails, Auth IDs, passwords/tokens, trade messages, invitation addresses, scoring payloads and reasons. Treat it as internal league operational information. It does not infer current penalty eligibility from old decision rows. Missing stat counts include test examples; inspect source scope before deciding they block launch. It does not label every unobserved setting as a failure.

Exit codes: **0** all automated findings verified (not a production certification); **2** report completed with attention/unverified findings; **1** runner could not complete. External checks currently always keep this an incomplete certification. Do not use `&& cat` when expecting code 2.

## Exact Codespaces procedure

After transferring these files to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:production-audit
```

In the same terminal, load your existing database URI privately if it is not already set (input is hidden and not put in shell history):

```bash
read -rsp 'Paste the current test-project database URI: ' DRAFT_TEST_DATABASE_URL
printf '\n'
export DRAFT_TEST_DATABASE_URL
export PRODUCTION_AUDIT_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
```

Use the existing session/direct URI on port 5432 with `/postgres` and no query parameters. Do not disable TLS verification. No owner passwords, Auth service keys or Fantrax cookies are required.

```bash
node run-production-audit.mjs > /workspaces/production-audit.json
audit_exit=$?
echo "Audit exit code: $audit_exit"
cat /workspaces/production-audit.json
```

Share that report, not the URI. Code 2 is expected because dashboard/behavior checks remain. Code 1 means the report is not complete. No migrations are required for the runner; missing schema is reported. Do not run migrations merely to make the audit pass without reviewing them.

## Dashboard evidence to gather next

1. **Supabase:** migration list, backup availability/retention and restore options, Auth configuration, scheduled expiry job state and Realtime publication. Never export keys or full Auth-user records into the report.
2. **GitHub Variables:** review `TRADE_ROSTER_PROJECT_REF`, `TRADE_ROSTER_SYNC_ENABLED`, `SCORING_ROSTER_CHECKS_ENABLED`, `SCORING_PROJECT_CONFIRM`, `SCORING_IMPORTS_ENABLED`, `FANTRAX_RENEWALS_ENABLED`, `FANTRAX_RENEWAL_PROJECT_REF`, `TRADE_EMAIL_ENABLED`, `TRADE_EMAIL_MODE`, `TRADE_EMAIL_NOT_BEFORE`, `TRADE_EMAIL_SITE_URL`. Check required secrets exist without revealing their values. Also inspect environment overrides under `fantrax-renewals`.
3. **GitHub runs:** latest roster/check storage, Tuesday standings, scoring backlog/status, renewal discovery, notification preview. A green disabled/no-source workflow does not prove useful work occurred.
4. **Vercel:** production branch/commit, website Supabase project match, Auth callback origin, private server key scoping. Preview and production must not accidentally use mismatched projects.
5. **Resend/Supabase Auth:** existing delivery test evidence; review trade email test/live mode separately. No email sends occur in this audit.

Then choose retain-versus-move and prepare specific previewable changes. No automatic cleanup or production cutover is included.

## Tests executed locally

The audit test loads every actual repository migration into PGlite, runs every inventory query, verifies read-only write rejection and rollback, missing-schema continuation, classification of rule/role/source/migration mismatches, current-project/TLS guards and omission of a seeded private email. This is offline schema/query validation, not hosted PostgreSQL concurrency or live Auth verification. No application production build is necessary: this task changes only audit scripts, tests and documentation.
