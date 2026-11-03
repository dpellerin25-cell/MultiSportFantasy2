# Commissioner-managed prospects

## Behavior

Doug can open **Rosters → Commissioner · Manage prospects**, choose an active owner and sport, enter a name, optional verified Fantrax player ID and audit reason, then review and confirm. Each active prospect uses one roster-cap slot across the five sports. 80 is compliant; 81 is over the cap. There are no new sport limits or roster restrictions on adding a prospect.

Commissioners can remove an active prospect at any time. Removal ends the manual cap slot; it never deletes a Fantrax player, past roster evidence, trade, draft selection or scoring history. To move a prospect to another owner, remove it with an explanation and add it to the receiving owner. These are separate audited operations. Prospects are not selectable trade assets in this version; commissioner management is the supported way to change their assignment.

Matching uses the **sport + verified Fantrax player ID + same owner**, never the name alone. IDs remain text, including leading zeroes. Unknown IDs can be linked later. If a verified ID is already on the same owner's imported roster when linked, the prospect is confirmed immediately. Otherwise a subsequent validated Fantrax roster import confirms it. A verified ID already on another owner's roster blocks ID linking; if it appears on another owner after adding a prospect, the label remains and the roster shows a warning for review.

Once confirmed, the prospect label disappears and the real Fantrax player supplies the cap slot. The website's existing JSON player lists may lag the database until their next refresh/deployment; database totals remain authoritative when all five sports have been imported. Unknown-ID prospects continue to count separately even if a similarly named player appears in Fantrax. Doug must verify/link the ID or remove a redundant placeholder; names are not enough to merge identities.

Active duplicate sport/ID and sport/normalized-name entries are rejected. If two different players truly share a name, use a distinguishing display label and verify their different IDs. Correcting a previously verified ID requires removing and re-adding with a reason, preserving the previous identity evidence.

## Count and history integration

- Roster cards and current owner summaries show database counts including prospects. Anonymous visitors can see prospect names/sports/owners and roster totals, but not commissioner audit reasons or Auth identities.
- Trade projection warnings include prospects but do not block a trade. Prospects are not injected into Fantrax's player catalogue or selectable trade assets.
- Overage-alert counts include prospects. Add/remove/link commands refresh alert state, and normal five-sport imports use the same count. Existing notification delivery performs the actual sends; no new delivery system is added.
- Future scheduled roster checkpoints include prospect IDs and separate Fantrax counts in their saved evidence. Evidence uses the actual fetch-completion time. Additions/removals after that observation do not change its historical count. A matching same-owner Fantrax ID is not counted twice.
- Existing daily/PGA penalty rules consume the saved combined count without formula changes. Prior checks, pauses, decisions and published standings are unchanged.
- Commissioner actions use stable request IDs and expected revisions. Imports and management use the existing roster/membership transaction lock. A failed five-sport batch rolls back prospect confirmations with the rest of the batch.
- Removing an owner with active prospects is blocked by membership validation.

## Files

- Migration: `supabase/migrations/202611030001_commissioner_prospects.sql`.
- UI: `web/src/components/Prospects.tsx`, roster cards/page, owner detail page, trade model and trade refresh listener.
- Scheduled evidence: `supabase/tests/daily-scoring-checks.mjs`.
- Tests: `supabase/tests/prospects.test.mjs`, `prospects-concurrency.test.mjs`, shared Docker runner and `web/tests/trades.test.mjs`.

## Validation completed locally

Passed prospect tests using all actual migrations in PGlite: commissioner/owner/anonymous permissions; duplicate and retry guards; stale revision rejection; 79 Fantrax + 2 prospects = 81, removal to 80; alert resolution; immutable historical counts; positive-only penalties retaining negative scores; exact-owner/ID confirmation; no name-only matching; wrong-owner warning; late ID linking; membership protection; public privacy; direct-write denial; immutable audit and failed-batch rollback.

Passed existing daily scoring-check, trade-roster sync, trade-roster catalogue, trade email, membership, yearly renewal and production-audit tests. All 12 web trade-model tests passed, including prospect projection warnings. The Next.js production build passed.

Not run here: independent PostgreSQL sessions (Docker unavailable), hosted Auth/RPC browser tests, real Fantrax prospect handoff, or email delivery. No hosted settings, database rows or migrations were changed. No commits, pushes, deployments or emails were made.

## Codespaces rollout

Transfer the reviewed changes first. Run:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:prospects
npx --yes pnpm@11.25.0 test:prospects-concurrency
node daily-scoring-checks.test.mjs
node trade-roster-sync.test.mjs
cd ../../web
npm run build
```

The concurrency command creates a disposable loopback-only PostgreSQL container, with no Supabase/Fantrax connection. It checks identical additions, confirmation-versus-removal, and removal-versus-import with observed lock waits. It prints a container-specific cleanup command; run it only for that disposable container after reviewing results.

After all tests pass:

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the pending list: the new migration is `202611030001_commissioner_prospects.sql`. Review any additional migrations separately. Then apply to the existing test project:

```bash
npx supabase db push --linked
```

Deploy/restart the website with the tested code and ensure the GitHub roster workflow also uses the updated `daily-scoring-checks.mjs`. **Do not add actual prospects until both the migration and updated scheduled importer are in place**, or the old importer would omit them from checkpoints. No new environment variables are required.

## Hosted browser checks before real use

1. Doug sees the control on Rosters; another owner and a signed-out visitor do not. Direct command calls by those users must also be rejected.
2. Add a clearly labeled test prospect without an ID to an agreed test owner. Confirm the count rises by one on public rosters and the owner's current summary. Check the trade-overage warning.
3. Remove it with a reason; confirm the count falls and its audit entry remains. Retry/refresh without creating duplicate additions.
4. To test matching, use an agreed genuine prospect with a verified Fantrax ID. After adding that player to the same owner's Fantrax roster and running the normal roster import, confirm the label disappears and the cap slot is counted once. Do not move real Fantrax players merely to create a test.
5. Inspect the next scheduled scoring checkpoint: its combined count includes active prospects, with `fantrax_count` and `prospect_ids` recorded in each sport's evidence. Old checkpoints must remain unchanged.

Test management changes commit actual prospect/audit rows and may queue overage alerts if the count exceeds 80. Keep notification delivery in test mode during those tests. Never falsify real historical roster checks to test penalty outcomes; the offline fixtures cover those cases.
