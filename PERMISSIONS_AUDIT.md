# Linked-owner permissions audit

## Verified locally (November 23, 2026)

The new `supabase/tests/permissions-audit.test.mjs` applies the real migrations
to an isolated database. It checks linked identities, owner-only trade visibility,
private account/role/command tables, Doug's commissioner reads, and denials for
other owners, an unlinked identity, and anonymous access. Regression checks prove
the audit fails if account-table write access is granted or a commissioner guard
is removed.

Existing suites passed for draft commands (12 scenarios), league settings,
owner invitations, scoring controls, hosted scoring scenarios run offline, and
prospects including owners dropping only their own prospects. These verify
commissioner write success and owner denials on synthetic data, not the live site.

Needs attention: the existing `trades.test.mjs` stops at its pick-ledger assertion:
270 rows exist versus an expected 180. Its later permissions scenarios therefore
did not run. This audit does not change draft-pick policy to satisfy that test.
The existing `trade-http-offline.test.mjs` also stops during fixture preparation
because its expected picks are unavailable; it does not establish HTTP scenario
coverage. Both trade fixture failures need review before declaring the full
trade permission regression suite green.

## Run against existing hosted links

The runner uses a repeatable-read, read-only transaction and always rolls back.
It creates no fixtures, sends no emails, signs in no users, changes no grants,
and never calls commissioner mutations as Doug. Denied mutation probes must fail
with a permission/commissioner error; a read-only or argument error is not a pass.
It expects 11 active linked owners and Doug as the only commissioner.

After making these files available in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
export PRODUCTION_AUDIT_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
# Use the existing private DRAFT_TEST_DATABASE_URL setting.
node supabase/tests/permissions-audit.test.mjs
node supabase/tests/run-permissions-audit.mjs
```

If the database URL is not already in the terminal environment:

```bash
read -rsp 'Supabase database connection URI: ' DRAFT_TEST_DATABASE_URL
printf '\n'
export DRAFT_TEST_DATABASE_URL
```

Success prints one verified entry per owner and verified outsider/anonymous
denials. Output contains owner slugs and findings, never passwords, tokens,
emails, private trade messages, or scoring records. A failure exits nonzero.
No database migrations or hosted configuration changes are needed.

## Still requires live verification

The runner impersonates existing Auth IDs through PostgreSQL's authenticated
role and JWT claims. It verifies SQL authorization, not actual login tokens,
PostgREST routing, browser controls, Realtime, or successful hosted mutations.

1. Sign in as an ordinary owner in a separate browser profile. Confirm their
   own identity, roster access, and absence of commissioner controls.
2. Sign in as Doug. Confirm League Settings, Scoring Controls, invitations and
   prospect administration are available.
3. Use a separate rehearsal draft for successful commissioner actions and
   owner picks. Do not start or change the real startup draft for this audit.
4. For hosted scoring writes, the existing `scoring-hosted.test.mjs` tests Doug
   and Chris with real sign-ins and rollback-only synthetic fixtures. It needs
   their credentials supplied privately using the documented DRAFT_TEST settings.
   Do not use the old `hosted.test.mjs`: it requires unlinked test accounts.

Until these hosted/browser checks pass, this is partial production-readiness
evidence, not a completed end-to-end permissions certification.
