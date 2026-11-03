# Rookie picks begin in 2028

There is no 2027 annual draft. The active roster/trade window begins with 2028 and 2029, ten rounds each. Existing 2028 IDs and owners are preserved. Existing 2027 rows and accepted-trade history remain for audit; they are excluded from active catalogues. Unaccepted proposals containing 2027 picks are invalidated with a recorded reason. Missing 2029 picks are created without resetting existing ownership.

The migration preserves the existing rolling next-calendar-year window after 2027. It does not change startup rounds, championship years or scoring.

## Test-project rollout

Transfer the reviewed changes to Codespaces first. From the repository root:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 test:rookie-years
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the pending migrations. This change is `202611030002_rookie_picks_2028.sql`; it requires the preceding commissioner-prospects migration. When ready to apply the reviewed migrations to the test project:

```bash
npx supabase db push --linked
```

Verify the public roster and signed-in trade composer both show 2028/2029, retain any traded 2028 picks under their current owners, and show ten 2029 picks for each original owner. Check that a former 2027 proposal is closed and accepted trade history remains visible. Then deploy the reviewed website changes through the normal process.

Migration operations are transactional; a failed application rolls back. Pick seeding uses conflict-safe inserts. Do not manually rerun an already recorded SQL migration.

## Validation scope

Local database tests cover retirement/history preservation, unchanged 2028 ownership and IDs, 2029 creation/trading/reseeding, rejected 2027 proposals, roster-import ownership preservation, public/member catalogue parity, and configuration/calendar parity. Website helper tests preserve historical ledger support. Hosted validation remains a rollout step; no hosted settings were changed by this implementation.
