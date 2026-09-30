# Trade database foundation

This is a local, unapplied migration and offline test suite. It does not change
the roster website, the file-backed rookie-pick editor, Fantrax fetching, draft
engine, or email delivery. Do not enable the website's trade feature until the
cutover and hosted checks below are complete.

## Rules and storage

The private `trading` schema reuses `draft.owners`, `draft.owner_accounts` and
`draft.league_roles`. No account or commissioner grants are created.

| Table | Purpose |
| --- | --- |
| `picks` | Rookie pick identity (year, round, original owner) and current owner; separate from startup draft slots |
| `ledger_import`, `pick_history` | One-time import of the durable legacy ledger and immutable transfers |
| `players`, `roster_snapshots` | Latest confirmed ownership and immutable, complete per-sport snapshots; player identity is league ID plus Fantrax ID |
| `trades`, `assets` | Offer lifecycle and immutable proposed assets |
| `player_reservations` | Prevent an accepted player being committed again while awaiting Fantrax |
| `events` | Immutable actions, corrections and completion history |
| `notifications` | Transactional email outbox; no email is sent by this migration |
| `requests` | Actor-scoped idempotency keys and saved results |

Offers support players, picks, mixed sports, unequal sides, and one-sided moves.
Only the next two UTC calendar years' rookie picks are eligible: 10 rounds for
each of the nine owners. Historical picks/history remain stored as years roll
forward. Newly needed years are seeded when a command runs.

Offers expire seven days after creation. Only the recipient may accept, decline,
or counter; only the proposer may withdraw. A counter creates a new offer with a
new seven-day deadline and permanently closes its parent. Private offers are
visible only to the two parties, even when the outsider is commissioner Doug.
Accepted agreements are visible to every active owner, with private messages
omitted for other owners.

Acceptance immediately transfers all picks and reserves all players in one
transaction. Competing proposals involving any of those assets are invalidated.
Players are not moved locally: confirmed ownership continues to reflect Fantrax.
Picks-only trades complete immediately. Player trades stay `accepted` until every
player appears with the destination owner in a complete snapshot observed after
acceptance. Missing players do not count as confirmation. Separate sports may
confirm at different times; all must confirm before completion.

Roster minimums produce warnings in the acceptance result/audit record, never
rejections. They use the imported rosters and this trade's projected transfers;
they are not a live Fantrax roster check. No roster maximums are enforced.

## Command/read boundary

Authenticated, active mapped owners can call:

```text
public.trade_command(request_id uuid, action text, args jsonb)
public.trade_list()
```

Every mutation requires a new client-generated request UUID. Retries must reuse
the same UUID and identical action/arguments. The saved original result is
returned without another transfer or notification. A current list read provides
the latest status after later updates.

`propose` arguments:

```json
{
  "recipient_id": "recipient-owner-uuid",
  "message": "Optional private message",
  "assets": [
    {"from_owner_id": "owner-uuid", "player_id": "trading-player-uuid"},
    {"from_owner_id": "owner-uuid", "pick_id": "trading-pick-uuid"}
  ]
}
```

Each asset has exactly one player or pick ID, and must currently belong to one
of the two owners. It goes to the other owner. These are internal UUIDs, not
Fantrax IDs. `counter` uses the same shape plus parent `trade_id` and `revision`;
its recipient must be the original proposer. `accept`, `decline`, `withdraw`
take `{ "trade_id": "...", "revision": 0 }`. Stale revisions are rejected.

`correct` is a commissioner-only **full reversal**, requiring `trade_id`, current
`revision`, and a nonempty `reason`. It restores picks immediately and waits for
fresh reverse Fantrax moves for players. The original agreement and all history
remain intact, marked with `corrected_at`. One reversal is allowed. It refuses
to overwrite a pick now held by another owner or a player reserved by another
accepted trade. Arbitrary edits or resolving chains of onward trades require a
separately designed correction workflow; they are not silent database edits.

`trade_list` exposes party IDs, immutable original asset directions, statuses,
revisions, and timestamps. A later UI must label corrected trades as reversals
and display reversed transfer directions when `corrected_at` is present. This
foundation is not yet a complete paginated roster/asset search API.

All tables have RLS and no browser table access. Only the two public entry points
are granted to `authenticated`; neither is available to `anon`. Private helpers
are not granted to owners. Functions have an empty search path. All command,
import, expiry and reconciliation transactions take the same league advisory
lock, serializing acceptance against roster refreshes and corrections. Unique
constraints protect identities, duplicate offer assets, player reservations,
request retries and queued notifications. Failed commands roll back everything.

## Trusted cutover and roster ingestion (not wired up yet)

1. Freeze the old rookie-pick editor during cutover. Read the **actual durable**
   deployed ledger, including any `ROOKIE_DRAFT_STORE_PATH` file. The checked-in
   empty file is not evidence that no live picks have moved.
2. A trusted backend/database operator calls
   `trading.import_pick_ledger(ledger_jsonb)` with the existing version-1 ledger.
   Owners are matched by existing display name; every transfer must agree with
   preceding ownership. History and original timestamps are preserved. Exact
   re-import is harmless; a different ledger is rejected. No trades can be
   created before this import. Do not keep the old file editor writing once the
   database becomes authoritative.
3. Add a trusted adapter to the existing roster refresh only in a later phase.
   After confirming successful Fantrax responses for all nine owners, call
   `trading.ingest_rosters(sport, league_id, observed_at, rosters_jsonb)` once per
   sport. The normalized payload is:

   ```json
   [{"owner":"doug","players":[{"player_id":"00123","name":"Example Player"}]}]
   ```

   Include all nine unique owner slugs, including empty rosters. Keep IDs as
   strings. Use the fetch observation time, never the time an old file is
   re-imported. Validate the expected league/team-to-owner mapping upstream.
   Database checks enforce nine known owners, unique player IDs, monotonic
   snapshots, fixed league/sport mapping, and no future timestamps. Exact latest
   snapshot retry is harmless. Missing players become unowned, not transferred.
   An authentication failure or partial fetch must never be converted to nine
   empty rosters: the database cannot independently verify Fantrax success.
4. Snapshot ingestion invalidates proposals whose player ownership changed and
   checks accepted trades for completion. Only snapshots newer than acceptance
   (or correction) confirm transfers. The existing daily updater is unchanged.
5. Schedule private `trading.expire_offers()` later. Acceptance/counter checks
   already enforce expiry at execution time, and reads show expired status even
   without a scheduler. No scheduled job is installed here.

## Email boundary

Proposal/counter notifications go to the recipient; declines to the proposer;
acceptance to both owners. Queue rows reference Auth user IDs, not public email
addresses. The future trusted worker should resolve addresses server-side,
claim jobs atomically with a lease, retry delivery, and use notification IDs as
provider idempotency keys. No delivery worker, credentials, provider, or domain is
configured. Email failure must not undo an accepted trade. Expiration, withdrawal
and correction emails are not currently queued.

## Validation and next phase

Run locally from `supabase/tests`:

```sh
npx --yes pnpm@11.25.0 test
```

Or run only the new suite with `node trades.test.mjs`. It applies every migration
to disposable in-memory PGlite and checks cutover, normalization, lifecycle,
ownership, privacy, retry, rollback, reconciliation, reversal and privilege rules.

These are **offline tests**, not proof of multi-session locking or hosted HTTP
behavior. Before release: run real PostgreSQL races (same offer, competing offers
sharing a pick/player, acceptance vs counter/expiry/import/correction), apply to
the disposable Supabase test project, verify real JWT permissions and email
worker behavior, and then build the roster UI. Preserve rollback/cutover backups.
Nothing in this work applies a migration or changes production.

## Running the new concurrency suite in Codespaces

The real runner uses three PostgreSQL connections: two competing transactions
and an observer. Each scenario holds the first transaction open, starts the
second operation, and verifies with `pg_blocking_pids` that the second backend
is blocked by the first before allowing it to commit. It tests both orderings
where relevant. Timeouts make lock failures bounded rather than hanging.

The 17 scenarios cover duplicate acceptance, concurrent identical retry,
competing pick/player offers, accept/counter, accept/withdraw, expiry (including
expiry while waiting for the lock), roster refresh/acceptance, onward
acceptance/correction, and Fantrax confirmation/correction. They assert final
ownership, lifecycle state, audit/transfer counts, reservations and notification
queue counts. Actual email delivery is not part of these tests.

First copy these updated local files into the same paths in Codespaces (or push
them yourself when ready and pull there). No push is performed automatically.
Then run:

```sh
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test
node run-trade-concurrency.mjs
```

Docker must already be running. The helper starts a fresh `postgres:17-alpine`
container with a random name/password, an automatically assigned loopback-only
port, no host mounts, and an empty `multisport_trade_test` database. It runs all
migrations **only inside that disposable database** and creates fake Auth users.
No Supabase settings, certificates, Fantrax cookies or account passwords are
needed. Every run creates a new container; it does not overwrite old test data.

Expect `17 trade concurrency scenarios passed` at the end. Share the output
before proceeding to hosted validation. On either success or failure the helper
prints inspection and optional removal commands for that specific container.
Fixtures and its anonymous volume remain until you explicitly remove them.

For an already-created empty disposable local PostgreSQL database, set
`LOCAL_TRADE_TEST_DB_URL` and run `node trade-concurrency.test.mjs` directly. The
runner refuses remote hosts, URL overrides, databases not named `*_trade_test`,
and databases containing tables or draft/auth/trading schemas. Use a new database
for each run. It requires an administrator solely to provision the local test
schema; owner commands execute as `authenticated` with mocked Auth claims.

`trade-race-offline.test.mjs` executes the same fixture/assertion scenarios
sequentially under PGlite. This catches SQL and scenario mistakes locally but is
explicitly **not** a substitute for the independent-session PostgreSQL runner.
`trade-runner-guards.test.mjs` checks rejected connection settings without
connecting to any database. Both are included in the normal offline suite.

## First hosted trade validation (rollback only)

`tests/trade-hosted.test.mjs` is restricted to `MultiSportFantasy-Draft-Test`
(`tgvuntuhdqucazpoxrrg`) through the existing test-project URL guard and full TLS
verification. It signs into the existing confirmed Doug and Chris accounts,
checks their actual owner links and roles, and exercises trade commands as the
`authenticated` database role. A third active owner must already have an account
link for league-member privacy tests; its password is not required, because
these checks use SQL role claims inside the transaction. Doug must be commissioner
and Chris must not be commissioner. No account links or roles are changed.

The trade schema must be unused: the runner refuses existing picks, imports,
rosters, trades, or notification/request rows. It imports an empty *fixture*
ledger inside its rollback transaction, not as a live cutover. It checks private
proposals, unauthorized acceptance, immediate pick movement, idempotent retry,
notification deduplication, public accepted history/private messages, audited
commissioner reversal, counters/declines, commissioner privacy, and blocked raw
table/helper/anonymous/outsider access. All fixture writes roll back even on
failure. No email worker is invoked. Identity sequences can advance despite a
rollback; Auth sign-in sessions can remain until expiry.

This test validates real Auth sign-in plus SQL role authorization. It **does not
validate HTTP trade RPC mutation/visibility or email delivery**. Those require a
separate test phase with committed, explicitly managed fixtures; rollback-only
fixtures cannot be read by separate HTTP database transactions. Do not treat
this first hosted pass as approval to release the roster-page feature.

After copying the new files to Codespaces (or pushing/pulling them yourself), run:

```sh
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 test
cd ../..
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

The expected pending migration is only `202609300001_trades.sql`. If other files
appear, review them first. Apply **only to the linked test project**, then test:

```sh
npx supabase db push --linked
cd supabase/tests
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node trade-hosted.test.mjs
```

Reuse the existing `DRAFT_TEST_DATABASE_URL`, `DRAFT_TEST_PUBLISHABLE_KEY`,
`DRAFT_TEST_DOUG_EMAIL`, `DRAFT_TEST_DOUG_PASSWORD`, `DRAFT_TEST_OWNER_EMAIL` and
`DRAFT_TEST_OWNER_PASSWORD` environment settings. `OWNER` is the Chris test
account. The database URL is the test project's direct/session-pooler URI, port
5432, database `postgres`, no query string, and a URI-encoded database password.
The runner lists **missing variable names only** and never prints credentials,
tokens, server response bodies or connection strings. The CA path above is the
existing persistent certificate location used for previous tests; do not disable
certificate verification if it is missing.

If settings have disappeared after a terminal restart, this Bash loop prompts
for each value without echoing it or putting it in shell command history:

```sh
for setting in DRAFT_TEST_DATABASE_URL DRAFT_TEST_PUBLISHABLE_KEY DRAFT_TEST_DOUG_EMAIL DRAFT_TEST_DOUG_PASSWORD DRAFT_TEST_OWNER_EMAIL DRAFT_TEST_OWNER_PASSWORD; do
  read -r -s -p "$setting: " "$setting"
  printf '\n'
  export "$setting"
done
```

Expected final line: `PASS hosted trade validation: all test rows rolled back; no
picks or notifications committed.` Share test output, not credentials. The
matching `trade-hosted-offline.test.mjs` executes the shared scenario in PGlite
and verifies rollback and refusal to touch a populated trade schema.

## HTTP trade validation — commits diagnostic records

`tests/trade-http.test.mjs` uses real JWT-authenticated HTTP requests to
`trade_list` and `trade_command` for Doug, Chris, and the third linked owner.
It checks anonymous/forged token denial, raw table denial, private offers,
unrelated-owner rejection, acceptance/retry, league visibility, private message
protection, commissioner reversal, counter/decline/withdrawal, and Doug's exclusion
from other owners' private negotiations. Direct SQL only prepares/verifies
fixtures and performs recovery cleanup. This is a **picks-only** HTTP diagnostic;
player transfers, Fantrax reconciliation, and email delivery remain separate
integration checks.

Unlike the earlier hosted SQL test, this test commits data. Run only in the
existing **test project**, before importing real trade rosters/picks and before
enabling any email worker. Do not use the trade UI or run other trade tests while
this diagnostic runs. A separate runner lock prevents two copies of this runner
from operating concurrently.

First use requires an unused trade schema. It seeds the 180 calendar-year rookie
picks and commits a clearly marked diagnostic ledger. Subsequent runs accept
only that ledger, fully cleaned-up diagnostic history, restored original pick
ownership, and no player roster imports. It refuses a real legacy ledger or
unresolved earlier run. This diagnostic ledger is **not** a production cutover;
do not use this test project's trade ledger as your live authoritative ledger.

Cleanup automatically withdraws open fixture offers, reverses any accepted
fixture picks, and sets this run's pending/failed notifications to `failed` with
`next_attempt_at = infinity`, suppressing them for a future worker that respects
the retry schedule. No email worker may be running during this test. Immutable
offers, audit events, requests, pick history, diagnostic ledger and seeded picks
remain for inspection. Constraints/triggers are never bypassed. Accordingly,
the earlier unused-schema rollback-only test will refuse to run afterward.

Copy these files to Codespaces in their matching paths (or push/pull yourself):

- `supabase/tests/trade-http.test.mjs`
- `supabase/tests/trade-http-support.mjs`
- `supabase/tests/trade-http-offline.test.mjs`
- `supabase/tests/package.json`
- `supabase/TRADES.md`

No new migration or dependency is required. Retain your existing `DRAFT_TEST_*`
credentials and add the third account's email/password. This must be the linked
ordinary test owner used for the preceding privacy check (e.g. Jack), not Doug
or Chris. In Codespaces:

```sh
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 test
read -r -s -p "Third linked owner's email: " DRAFT_TEST_THIRD_EMAIL
printf '\n'
export DRAFT_TEST_THIRD_EMAIL
read -r -s -p "Third linked owner's password: " DRAFT_TEST_THIRD_PASSWORD
printf '\n'
export DRAFT_TEST_THIRD_PASSWORD
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
export TRADE_HTTP_TEST_CONFIRM=COMMIT_TEST_FIXTURES
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node trade-http.test.mjs
```

The extra confirmation explicitly acknowledges persistent test fixtures. The
runner still guards the database URI and HTTP endpoint to the test project,
uses verified TLS, and does not print tokens or passwords. Expected final PASS:

```text
PASS hosted HTTP trade validation. Email delivery and player/Fantrax transfers were not tested.
```

Save the printed run ID. A failed, interrupted, or disconnected run can leave
records needing attention. With the same environment settings, use the printed
recovery command, prefixed with the CA setting:

```sh
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node trade-http.test.mjs --cleanup RUN_ID_FROM_OUTPUT
```

Recovery is idempotent and restricted to that run's tagged records. It will not
overwrite picks moved onward or reverse unexpected player trades. If recovery
fails, share the output rather than deleting data or weakening constraints.
Auth sessions may remain until expiry. The matching offline suite exercises
the same scenario with mocked HTTP transport backed by actual migrated SQL,
including cleanup after interrupted acceptance; it is not a hosted HTTP pass.
