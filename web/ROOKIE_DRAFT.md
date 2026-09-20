# Rookie draft picks

The roster page displays the next two calendar years (UTC). In 2026 this is
2027 and 2028. Each of the nine owners in `src/lib/rookieDraft.ts` starts with
one pick in each of ten rounds per year. A pick is identified by year, round,
and original owner, not its eventual draft position. Picks are separate from
the player cap. Update the owner registry deliberately if league membership changes.

## Commissioner access

Set `ROOKIE_DRAFT_COMMISSIONER_PASSWORD` in `.env.local` and restart Next.js.
The local setup has generated this password in that ignored file. Do not commit
or share it with league owners. Open Rosters, choose Commissioner controls,
enter the password, and unlock editing. Expand an owner, choose Transfer beside
a pick, select its new owner, and save. To reverse a trade, transfer the pick back.

The password is held only in the current page's memory while editing. Reloading
the page or choosing Lock editing removes it. Every write is authenticated on
the server. Use HTTPS for any non-local access. This is a single commissioner
credential, not a multi-user account system.

## Persistence and deployment

Local trades are saved atomically in `data/rookie-draft.json`; they survive
refreshes and server restarts. Keep this file backed up. Fantrax only writes its
sport and roster files, so its updater does not reset draft picks. Each transfer
is appended to the ledger, preserving original ownership and trade history.
Old years remain in the ledger but are hidden from the roster page. Use Refresh
picks to see another session's updates. Stale or concurrent writes are rejected.

No hosting configuration was changed. Production editing remains disabled unless
both the commissioner password and `ROOKIE_DRAFT_STORE_PATH` are set. That path
must be an absolute path on a durable, writable disk shared by the server's
processes. If the file does not exist, the committed ledger seeds it on the first
trade. Do not point this at ephemeral serverless storage. For a serverless or
multi-instance deployment, replace the file store with a shared database and
transactional writes before enabling online trades.

If a process is killed mid-write, verify the ledger and remove its adjacent
`.lock` file only after confirming no writer is running. The app fails rather
than replacing an unreadable or invalid ledger with defaults.

## Checks

With Node 24: `node --test tests/rookie-draft.test.mjs`

Also run the existing `npm run lint` and `npm run build` checks.
