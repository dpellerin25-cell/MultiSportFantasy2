# Fixed draft rankings

Captured September 29, 2026. The application and database make no requests to these providers. Refreshing Fantrax players does not refresh these rankings.

| Sport | Snapshot | Entries | Source update shown |
|---|---|---:|---|
| NFL | User-supplied FantasyPros Dynasty Superflex PPR CSV | 369 | September 29 |
| MLB | FantasyPros dynasty overall | 591 | August 26 |
| NBA | FantasyPros dynasty overall | 446 | March 3 |
| EPL | RotoWire 2026/27 FPL overall | 430 | September 2 |
| PGA | ESPN 2026 PGA Tour earnings, descending | 222 | 2026 season at capture |

Each JSON snapshot records the source URL, capture date, source update and original rank. The EPL article's title says Top 400, but its table contains 430 ranked rows. PGA has tied ranks; these are preserved. EPL and PGA are not dynasty valuations.

## Ordering and matching

The existing authenticated `draft_available_players` RPC now sorts the entire eligible pool before taking a page. Ranked players come first, lowest number first. When viewing all sports, ties use sport then player name and UUID. Unranked/unmatched players follow alphabetically, with UUID breaking identical names. These are separate sport ranks, not a combined valuation system.

Matching requires a unique normalized name within the same sport in both the frozen draft pool and ranking snapshot. Normalization removes accents, punctuation, spacing and common generational suffixes. Ambiguous names and unmatched names receive no rank rather than guessing an identity. For example, the MLB source has two Luis Garcia entries. Nicknames or entirely different display names require a separately reviewed identity mapping; no fuzzy matching is used.

The UUID cursor resolves against the frozen pool, including players drafted after the preceding request. Selected players remain excluded. Search and sport filtering remain supported. Existing selection/authorization/clock logic is unchanged; no direct browser access to the ranking table is granted.

## Enable in the test project

Transfer the code to Codespaces through your usual GitHub workflow, then from the repository root run:

```bash
git pull --ff-only origin main
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

The ranking migration is `202609290001_player_ranking_snapshot.sql`. The Available Players position filter additionally requires `202609290002_available_position_filter.sql`. Already-applied migrations will not be listed. Review any other pending migrations before proceeding. Then apply to the linked **test** project:

```bash
npx supabase db push --linked
```

Restart the website with the updated local files, and reload `/draft` from the first player page. The panel should show `Fixed rankings · 2026-09-29`. Without the migration, it explicitly says ranked sorting is not installed; it does not mislabel the old ordering as ranked.

No Fantrax cookie, fresh pool import, or new environment variable is required. Existing drafts/picks are preserved. These instructions do not deploy to production.

The position filter runs before pagination, using exact position tokens split on commas, slashes, semicolons or whitespace. For example, F matches G/F but PG does not match G/F. Options come from the full eligible, undrafted pool for the selected sport, not just the current page. Changing sports clears the position selection. The existing five-argument RPC is preserved for older clients; the new six-argument call adds `position_filter` and returns `available_positions`.

## Offline verification

```bash
cd supabase/tests
node rankings.test.mjs
node ../rankings/build-migration.mjs --check
```

The normal database test suite also includes these checks. Tests cover snapshot counts, normalized matching, sport isolation, ambiguous identities, complete multi-page ordering, drafted cursor handling, selected-player exclusion, input limits, member-only RPC access, and blocked direct reads/writes.

`build-migration.mjs` is an offline build tool, not a scraper. After this migration is applied, future ranking updates must use a new migration/version rather than rewriting this historical migration.
