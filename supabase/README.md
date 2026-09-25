# Draft database foundation

For unstarted startup rehearsal setup and snake-order previews, see
[DRAFT_SETUP.md](DRAFT_SETUP.md). This administrative tool targets only the
isolated test project and requires explicit order and timer choices.

Validated player-pool importing is now available locally. See
[PLAYER_POOL_IMPORT.md](PLAYER_POOL_IMPORT.md) for the test-only workflow and
the new, not-yet-applied `202609250001_import_snapshot_guards.sql` migration.

The three migrations have been applied by the league administrator to the isolated
`MultiSportFantasy-Draft-Test` project, not production. For the next validation
step see [HOSTED_VALIDATION.md](HOSTED_VALIDATION.md). The hosted runner is opt-in;
ordinary tests still use only an in-memory database. The original foundation
notes below describe the initial local-only stage.

**Update:** migration `202609240003_draft_commands.sql` now adds authorized
transaction commands and embedded behavior tests. See [COMMANDS.md](COMMANDS.md)
for the API, defaults, verified behavior and remaining deployment gates. The
foundation-only descriptions below describe the first two migrations; the third
grants authenticated execution of exactly one checked SECURITY DEFINER function.
It does not grant client table writes or member read policies.

Nothing in this directory connects to the hosted Supabase project. Do not apply
these migrations to production yet. There is no Supabase project link/config,
authentication flow, browser integration, or automatic deployment hook here.

## Files

- `migrations/202609240001_draft_foundation.sql`: private `draft` schema,
  15 tables, constraints, RLS, history guards, frozen pool, startup rules and
  privileged snake-slot generation helper.
- `migrations/202609240002_owner_seed.sql`: the nine existing owners with stable
  UUIDs. Names/slugs match the website. This order is not the draft order.
- `tests/schema.test.mjs`: actual PostgreSQL SQL execution using an in-memory
  PGlite instance. Minimal `auth.users`, `auth.uid()`, anon/authenticated roles
  are created ONLY inside the test database. They are not production migrations.
- `tests/package.json`, `tests/pnpm-lock.yaml`: isolated test dependency; the
  website package and lockfile are untouched.

## Run locally

With Node.js and pnpm available:

```sh
cd supabase/tests
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
```

Tests use no environment files, Supabase keys, database URLs, or network database.
Dependency installation downloads PGlite; the test run itself is in memory.
PGlite is a PostgreSQL WASM build: https://pglite.dev/docs/about
It does not establish multi-session concurrency, Supabase Auth or Realtime behavior.

## Schema decisions

Owners, accounts, and roles are separate. Doug is the intended commissioner,
but no role or account link is seeded. Later, an administrator must link Doug's
verified auth.users UUID and grant the commissioner role. A matching name grants
nothing. Auth rows are never invented by these migrations.

Players retain source mappings (provider + source league + external ID).
Import entries preserve source availability/details; draft pool entries freeze
the draft's chosen snapshot. UUID identities decouple the engine from Fantrax.
An eligible entry must be free_agent or waivers; unknown is not auto-eligible.
PGA position/professional-team fields remain nullable.

Startup drafts require 9 participants and 65 rounds. Inserting a startup draft
seeds sport minimums NFL=9, NBA=8, MLB=14, EPL=11, PGA=6, without maximums.
No actual draft, order, player, selection, or import is seeded.

The SQL administrator can configure order in draft_participants, then call
draft.generate_snake_picks(draft_id). It locks the draft row and requires a full
contiguous order. It creates 585 slots with alternating round direction.
Generation should be part of the future start transaction; it freezes order.
It intentionally cannot be rerun or regenerate existing slots. No placeholder
commissioner order is assumed.

Pick slots retain original and current owner separately. An unfilled skipped
slot has skipped_at and no active selection. Filling it later inserts a selection
without changing its round or number. Future unselected picks can change owner;
both owners must be participants. A slot with selection history cannot be traded
through a casual FK-breaking update. Trading functionality is not implemented.

Selections link the draft, slot, receiving owner, eligible pool player, and sport
with composite foreign keys. Partial unique indexes enforce one active selection
per pick and one per draft/player, including across conflicting transactions.
Selection insertion locks the draft row. Every future mutation RPC must acquire
that same lock before reading turn state. Original selection data cannot be edited
or deleted. Undo can only append void_at/reason once; an audit event captures the
selection, round, number, and original owner. Events cannot be edited/deleted by
ordinary SQL DML. Database owners remain trusted and can alter schema/triggers.

## Deliberately unfinished: do not expose as a live draft API

This migration is the schema layer, not the completed draft engine. No client
can write tables or invoke helpers: all tables use RLS with NO read policies,
anon/authenticated have only SELECT grants (which return no rows), and all
function execution is revoked for those roles. The draft schema is not configured
as an exposed Data API schema. Service credentials/SQL administrators remain
privileged. No public SECURITY DEFINER functions are introduced.

Before hosting a usable draft, implement and test these separately:

1. Staged import validation/finalization, immutable ready-import enforcement,
   and copying only validated data into a draft's pool.
2. A start transaction verifying ready import, owner count, exact startup rules,
   minimum feasibility, order, and configured timer before generating slots.
3. Authenticated make_pick RPC: verified identity, current owner/pick, server
   deadline, minimum feasibility including skipped slots, and atomic cursor/
   deadline/revision/event updates. Existing schema alone does NOT enforce turn,
   deadline, or minimum feasibility on privileged SQL inserts.
4. Idempotency lookup/result writes in the same transaction as each command.
   draft_commands only provides storage/uniqueness at this stage.
5. Role-checked start/pause/resume/skip/assign/undo operations and audit events
   for controls. Timer worker and deadline recovery. Current helper never starts
   the draft and selection triggers do not advance its cursor.
6. Supabase policies for verified members; permission tests using real JWT roles.
7. Multiple real PostgreSQL sessions racing picks, skips, assignments, and undo.
   Embedded tests exercise uniqueness and row locks but not simultaneous sessions.
8. Decide timer duration/change behavior, undo semantics and spectator visibility.
   Then link Doug's account, test in local Supabase, review migrations for deployment.

No existing standings, roster, scoring, history, Trophy Case, rookie ledger,
Fantrax scripts, or web dependencies are modified. Existing file-based rookie
pick trades remain independent; a later explicit migration can map their
year/round/original-owner identities to this model.
