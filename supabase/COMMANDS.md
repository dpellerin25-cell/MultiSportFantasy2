# Draft commands — local, not deployed

Migration `202609240003_draft_commands.sql` adds a single transaction function:

```sql
select draft.command(draft_uuid, request_uuid, expected_revision, action, args_json);
```

The private schema is still not exposed through the Data API, no account has
been linked, and no website/auth/timer-worker code exists. Do not apply to hosted
Supabase yet. This migration uses one SECURITY DEFINER entry point with an empty
search_path and fully qualified application references. EXECUTE is granted only
to authenticated, not anon/PUBLIC. All internal helpers remain inaccessible.
Caller identity is auth.uid(); owner/commissioner permissions come from protected
database mappings. No actor/owner/commissioner identity is accepted in arguments.

## Supported commands

| Action | Arguments | Behavior |
| --- | --- | --- |
| set_order | owners: ordered array of owner UUIDs | Commissioner; setup only; exact unique participant count; freezes after generation. |
| set_timer | seconds: integer 1..86400 | Commissioner; future turns only; leaves current deadline or paused remainder unchanged. |
| start | {} | Commissioner; requires timer, ready import, sufficient pool, valid order, startup rules and feasible minimums; generates slots atomically. |
| pick | pick_id, player_id | Current owner only; running draft, current slot, unexpired database deadline. |
| expire | pick_id | Any authenticated participant or commissioner can request it; succeeds only for the current overdue running slot. Leaves it unfilled and advances once. |
| pause | {} | Commissioner; persists remaining seconds and clears deadline. |
| resume | {} | Commissioner; resumes from saved remaining time, including zero. |
| assign | pick_id, player_id | Commissioner; fills current or skipped slot, never an arbitrary future slot; skipped makeup does not consume current turn. |
| undo | selection_id, reason | Commissioner; latest active selection only; paused, awaiting makeups, or completed draft. Voids history and reopens a makeup slot without rewinding. Completed draft becomes awaiting_makeups. |

Timer and undo behavior are conservative implementation defaults, not new UI
features. Initial timer has no automatic value: configure before starting.
An explicit action for extending the current timer is not implemented.

Each successful command locks the draft row before checking revision/time/state,
then writes mutations, events, revision and idempotency result atomically.
Retries require the same request UUID, actor, action, arguments and original
revision; they return the stored result even when the draft has since advanced.
A reused UUID with different contents is rejected. Failed commands roll back all
changes and do not consume the request ID. Stale commands require refresh and a
new intentional request rather than blindly substituting the new revision.

The deadline is checked with clock_timestamp AFTER acquiring the lock. A worker
delay does not allow late owner picks. Expiration advances only one slot and sets
a fresh duration for the next owner, never a catch-up cascade. The worker itself
remains unimplemented: nobody should assume expiration runs with browsers closed
until a trusted scheduler is connected. service_role by itself is not a player
identity; a worker integration needs an explicitly authorized pathway later.

Minimum checks count all remaining owned unfilled slots, including skips, and
reject picks that make the owner's minimums impossible. They also reject a pick
that would leave too few eligible players in any sport to meet all owners' remaining
deficits. Commissioner assignments use the same checks and uniqueness constraints.
Last scheduled slot transitions to completed only when all slots are filled;
otherwise awaiting_makeups persists. Draft rosters are selection-derived only.

## Verification

`pnpm test` runs the schema and command suites using isolated in-memory PGlite.
It tests actual SQL, mocked auth.uid() context, allowed/denied roles, rollback,
idempotency, deadline expiration, paused timers, makeup assignment and undo.
It does NOT simulate multiple PostgreSQL sessions.

`pnpm test:concurrency` is an opt-in real PostgreSQL race test. It requires a
separate EMPTY local database whose name ends in `_draft_test`, plus an admin
connection in LOCAL_DRAFT_TEST_DB_URL. It refuses remote hosts and URL query
overrides. Never use a Supabase URL. It creates test-only auth scaffolding,
applies migrations, and uses independent sessions with an observed lock wait to
test competing commands and duplicate-player constraint enforcement. It leaves
the disposable database for inspection; reruns require a fresh empty database.
No PostgreSQL server/Docker is installed here, so this suite has not been run.

## Still required before hosted use

- Run the independent-session suite on local PostgreSQL and local Supabase.
- Add actual JWT integration tests (embedded tests use an auth.uid() stub).
- Build reviewed import staging/finalization: ready status is currently a trusted
  SQL-admin assertion, not proof that an importer validated all five source pools.
- Link Doug's verified account and the remaining owners; no names grant access.
- Add safe member read policies, Data API exposure strategy, and Realtime recovery.
- Add timer worker and browser integration; no credentials or UI added here.
- Add commissioning/setup UI or API for creating a draft and selecting an import;
  draft creation and pool loading remain privileged SQL/import operations.
