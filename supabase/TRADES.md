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
