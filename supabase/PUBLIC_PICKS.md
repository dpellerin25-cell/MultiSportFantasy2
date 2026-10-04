# Supabase pick ownership cutover

All website roster pick lists now read the same Supabase `trading.picks` rows.
No local ledger fallback or password-based editor remains. The historical
`web/data/rookie-draft.json` file is preserved only for audit/initial import;
it is never read or written by the deployed roster page or its API.

## Apply to TEST before deploying the website changes

1. Transfer the reviewed files to GitHub/Codespaces when ready.
2. Link `tgvuntuhdqucazpoxrrg` and run `npx supabase db push --linked --dry-run`.
3. Expect `202610040003_public_pick_ownership.sql` (and any earlier unapplied
   changes). Review, then apply to TEST with `npx supabase db push --linked`.
4. Deploy the website changes using the same existing
   `NEXT_PUBLIC_DRAFT_SUPABASE_URL` and
   `NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY` as the trade interface. This
   implementation retains its test-project restriction; production cutover is
   still separate. No database password or service-role key is used for reads.
5. Open Rosters signed out and signed in. Expand the same owner and compare
   original owner, round, year and current ownership. Accept a test pick trade:
   the accepting browser refreshes immediately, other open pages refresh within
   30 seconds while visible or on focus, and Refresh picks works on demand.
6. Confirm a commissioner reversal is reflected too. Verify private proposals
   are still restricted, and POST `/api/rookie-draft` returns HTTP 410 even with
   the former shared password. Remove the unused `ROOKIE_DRAFT_COMMISSIONER_PASSWORD`
   and `ROOKIE_DRAFT_STORE_PATH` deployment settings after cutover. Preserve any
   external ledger file for audit; do not delete it as part of this transition.

If the Supabase ledger was never imported, the page explicitly says ownership
is not initialized. Use the existing reviewed ledger-import procedure first;
do not initialize an empty ledger over real traded pick history. If the database
or public RPC is unavailable, the page reports failure rather than generating
default ownership or displaying an outdated file.

## Security and year rollover

The only new public permission is execution of the read-only
`public.rookie_pick_ownership()` function. It returns the next two UTC calendar
years, pick IDs/rounds and current/original owner IDs and names. It exposes no
account mapping, email, private offer, message, notification, or trade history.
Raw tables and private helpers remain inaccessible to anonymous/member roles.
Pick mutations continue through existing authorized atomic trade commands.

The daily trusted roster batch seeds missing next-two-year picks only after the
legacy ledger has been imported, using conflict-safe insertion that never resets
existing ownership. Public reads do not write anything. An incomplete future
year is labeled uninitialized until the trusted daily batch fills it. The migration
also ensures the current two-year horizon exists on already-initialized projects.

The website API and upstream RPC requests both disable caching. Failed refreshes
clear the displayed pick list instead of presenting stale data as current. The
proposals/trade asset picker continues to use the authenticated catalogue backed
by the same `trading.picks` table.

## Validation

- `node public-picks.test.mjs` in `supabase/tests`: anonymous/member parity,
  acceptance and reversal, privacy, denied raw writes, two-year filtering,
  read-only missing-year behavior and safe daily initialization.
- `node tests/public-picks.test.mjs` in `web`: no-cache public fetch, no owner
  credentials, failures without a local-file fallback.
- Full offline database suite, TypeScript, lint and production build.

No migration, commit, push or hosted cutover is performed automatically.
