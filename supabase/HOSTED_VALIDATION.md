# Isolated hosted validation

Only project **MultiSportFantasy-Draft-Test**, reference `tgvuntuhdqucazpoxrrg`.
No migrations, website changes, permanent account links or permanent role grants
are performed by this test. The three migrations must already be applied.

This verifies real Supabase email/password sign-in and confirmed user lookup,
then exercises the existing database commands under `authenticated`/`anon`
roles using those verified user IDs and the hosted `auth.uid()` implementation.
It deliberately does not expose the private draft schema through the Data API.
It is **not** an end-to-end JWT-to-PostgREST/RPC test, a Realtime test, or a
replacement for the multi-session concurrency test already run in Codespaces.

## Prepare in the TEST project

1. In Authentication → Users, create two confirmed email/password test users
   with distinct email addresses you control and new test-only passwords.
   One represents Doug; the other represents an ordinary owner (temporarily
   Chris). This does not create website login functionality. Do not use another
   owner's real credentials.
2. Do not manually link these accounts or grant roles. The script requires both
   accounts and the Doug/Chris owners to be unlinked, and neither test account
   to have a commissioner role. Temporary links and Doug's temporary role are
   rolled back with all test draft data.
3. From the project's Connect dialog, copy the direct or **session pooler**
   PostgreSQL connection URI, port 5432, database `postgres`. Use session pooler
   if Codespaces cannot reach the direct IPv6 host. Replace the password
   placeholder with the test project's database password, URL-encoded if needed.
   Remove query parameters; the script enables certificate-verified TLS itself.
   Never disable TLS verification. If your environment needs the project's CA,
   supply its downloaded certificate using `NODE_EXTRA_CA_CERTS`.
4. Copy the test project's publishable API key. No service-role key is needed.

## Run in Codespaces after transferring these tested files

From the repository root:

```bash
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test
```

Read credentials interactively so values do not appear in shell history:

```bash
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
read -rsp 'TEST database connection URI: ' DRAFT_TEST_DATABASE_URL; echo
read -rsp 'TEST publishable API key: ' DRAFT_TEST_PUBLISHABLE_KEY; echo
read -rp 'Doug test email: ' DRAFT_TEST_DOUG_EMAIL
read -rsp 'Doug test password: ' DRAFT_TEST_DOUG_PASSWORD; echo
read -rp 'Other test email: ' DRAFT_TEST_OWNER_EMAIL
read -rsp 'Other test password: ' DRAFT_TEST_OWNER_PASSWORD; echo
export DRAFT_TEST_DATABASE_URL DRAFT_TEST_PUBLISHABLE_KEY
export DRAFT_TEST_DOUG_EMAIL DRAFT_TEST_DOUG_PASSWORD
export DRAFT_TEST_OWNER_EMAIL DRAFT_TEST_OWNER_PASSWORD
npx --yes pnpm@11.25.0 test:hosted
unset DRAFT_TEST_DATABASE_URL DRAFT_TEST_PUBLISHABLE_KEY
unset DRAFT_TEST_DOUG_EMAIL DRAFT_TEST_DOUG_PASSWORD
unset DRAFT_TEST_OWNER_EMAIL DRAFT_TEST_OWNER_PASSWORD DRAFT_TEST_CONFIRM
```

Expected: four PASS groups and a final rollback confirmation. All fixture data,
owner mappings and role grants are inside one transaction, always rolled back.
The test uses synthetic players clearly labeled as validation fixtures, never
Fantrax data. It refuses other database project hosts/users before connecting.
Existing Auth users remain; sign-in can leave Auth sessions/audit entries.
Audit identity sequence numbers may have gaps after rollback; this is normal.
No auth tables/functions are created or replaced. On failure, the runner prints
only the error class/code to avoid leaking secrets. Share the PASS/FAIL output,
not credentials or connection strings. Do not run `concurrency.test.mjs` hosted.

After this passes, remaining gates include the actual application RPC boundary,
member read policies, Realtime, validated pool import, and a timeout worker.
Passing this test alone does not mean the draft system is production-ready.

Auth reference: https://supabase.com/docs/guides/auth/jwts
