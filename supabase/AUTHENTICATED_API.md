# Authenticated draft API — test project only for now

This step adds three Supabase HTTP RPC endpoints, two verified test-account links,
offline tests and a hosted HTTP validation script. No website login or draft UI,
Realtime subscription, background timer worker, or production deployment is built.
No hosted commands were executed during implementation.

## API design

The private `draft` schema stays unexposed. All tables retain RLS and no direct
client read/write policies. Member reads use explicit authorization inside two
narrow SECURITY DEFINER functions with empty search paths and qualified names.
Their private helper is invoker-only and not executable by client roles.
Anonymous execution is revoked. The third function is SECURITY INVOKER and
delegates unchanged to the existing authorized command engine.

HTTP POST endpoints in the default exposed `public` schema:

- `/rest/v1/rpc/draft_state` with `{ "target": "draft UUID" }`: draft revision,
  server time, deadline, owner order, rules, current selections and skipped slots.
  No auth user IDs, email addresses, command log, or actor identities are returned.
- `/rest/v1/rpc/draft_available_players`: `target`, optional `sport_filter`,
  `search_text` (literal case-insensitive substring, max 100 chars), `page_size`
  (1–100), and `after_player` UUID cursor. Returns draft revision, bounded rows
  and `next_cursor`. Reset the cursor when filters change. Page ordering is stable
  internal UUID order, not player rank. Active selections are excluded on each
  request; refresh after revision changes. This does not itself push updates.
- `/rest/v1/rpc/draft_command`: `target`, UUID `request_id`, `expected_revision`,
  `action`, `args`. Existing engine enforces owner/commissioner permissions,
  current turn, timing, uniqueness, revisions, locking and idempotency. Retry an
  uncertain request with exactly the same request ID and payload. Player IDs in
  these APIs are internal UUIDs, not Fantrax source IDs, which stay preserved in
  the private source mapping tables.

Requests use the project's publishable API key and the signed-in user's access
token (`Authorization: Bearer ...`). PostgREST validates the JWT and provides the
auth context. Never accept an owner ID from the client as proof of identity.
No database password or service-role key belongs in the browser. Valid outsiders
and inactive noncommissioner owners cannot read these APIs. An explicitly granted
commissioner can access all drafts. No signup by itself grants membership.

Official pattern: https://supabase.com/docs/guides/database/functions

## 1. Transfer, test, and apply the API migration to TEST

Transfer the new/changed files through GitHub; no push was performed here.

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 test
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Only `202609260001_draft_api.sql` should be pending after the four prior migrations.
Review that target and list, then run `npx supabase db push --linked`. Public must
be an exposed schema with the Data API enabled (the standard Supabase setup).
Do not expose `draft`. The migration requests a schema cache reload.

## 2. Preview account links before applying

Use the same two confirmed test accounts you used earlier. The ordinary account
represents Chris in this rehearsal, not a claim to Chris's actual identity. Doug
must use the account you intend to represent Doug. Only these two are linked;
the remaining seven owners need verified account linking in a later rollout.

Required exported settings: `DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg`,
`DRAFT_TEST_DATABASE_URL`, `DRAFT_TEST_PUBLISHABLE_KEY`, `DRAFT_TEST_DOUG_EMAIL`,
`DRAFT_TEST_DOUG_PASSWORD`, `DRAFT_TEST_OWNER_EMAIL`, `DRAFT_TEST_OWNER_PASSWORD`.
Enter missing passwords privately using `read -rsp` as in HOSTED_VALIDATION.md.

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node link-test-accounts.mjs --preview
```

The tool verifies both credentials with the TEST Auth service and confirms both
auth UUIDs exist in the target database. Review the printed UUIDs against those
two users in the Supabase dashboard. The preview rolls back temporary mappings
and grants. Then persist those reviewed links:

```bash
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node link-test-accounts.mjs --apply
```

This **persists** Doug's commissioner role and both owner links in the TEST
project. It does not reset existing links, resolve conflicts, create Auth users,
or grant roles merely based on an account's name. Identical retries are safe;
conflicting mappings and a privileged ordinary account are rejected. Never use
someone else's real credentials to impersonate them. The earlier rollback-only
`hosted.test.mjs` expects unlinked owners and should not be rerun after this step.

## 3. Exercise real authenticated HTTP requests

```bash
node http-draft.test.mjs
```

This script is fixed to TEST project `tgvuntuhdqucazpoxrrg` and rehearsal draft
`4f7c9484-bc03-46cf-ae5f-8a0781061844`. It signs in through Auth and sends real
JWTs to the HTTP RPCs; it does not use SQL impersonation or a database password.
It checks member identities, public/forged-token rejection, bounded pagination,
ordinary-owner command denial, and a commissioner command with an idempotent
retry. The command sets the existing timer to the same value. It permanently
adds ONE successful command/audit record and increments the draft revision once.
Each rerun adds one more. The draft remains in setup with no picks or deadline.
If any assertion fails, stop; the script cannot roll back prior HTTP requests.
Auth sign-in sessions may remain until expiry. No secret values are printed.

## Coverage and remaining limits

Offline tests run actual SQL functions and verify account-link transactions,
public wrapper picks and retries, duplicate-player denial, inactive/outsider/anon
read denial, permission isolation, active-selection exclusion, pagination and
search bounds. Existing tests remain in place. The HTTP script still needs to
run in Codespaces after applying the migration. Its rehearsal checks do not
start the draft or select players; live HTTP races/picks require a separate
throwaway draft. Earlier concurrency tests exercised the same underlying engine.
Realtime, automatic timeout processing, website integration, a nine-owner Auth
rehearsal and production readiness remain separate gates.
