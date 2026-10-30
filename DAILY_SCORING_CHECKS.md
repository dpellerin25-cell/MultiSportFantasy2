# Daily roster-count evidence

The existing `Update Fantrax Data` scheduled roster run can now store checkpoint
counts in `scoring.roster_checks` in the same transaction as trade roster sync.
Requires the scoring ledger, 80-player policy, and `202610300001_scheduled_check_timing.sql` migrations. No new secret is required.

## October 30 timing change: rollout

The scheduled job still targets 4 a.m. Eastern. A delayed run now measures
eligibility at actual five-sport fetch completion, rather than failing solely
because it ran after 4:59. Its actual Eastern date determines the checkpoint:
daily sports apply it to the previous date, and PGA uses Thursday and Sunday.
There is no backdating if a run slips into another calendar day. Cross-midnight
captures remain pending/skipped because they do not provide a single dated snapshot.
PGA still finalizes no earlier than Tuesday 8 a.m. Eastern.

After transferring these local changes through your normal reviewed Git workflow:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 test:daily-scoring-checks
node scoring.test.mjs
node scoring-race-offline.test.mjs
node trade-roster-sync.test.mjs
cd ../..
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Expect `202610300001_scheduled_check_timing.sql`. Review any other pending migrations
separately. Once approved for the test project:

```bash
npx supabase db push --linked
```

No existing rows are updated by this migration. October 30 records already saved
as incomplete remain incomplete. A rerun preserves them and reports
`existing_check_preserved`; the summary also remains `complete: false`.
The next day's scheduled update can create complete records at its actual run time.
Manual refreshes remain excluded, and exact retries do not duplicate rows.

Use this read-only SQL in the same project as `TRADE_ROSTER_PROJECT_REF`:

```sql
select c.check_date, o.display_name, c.complete, c.total_players,
       c.payload->>'timing_policy' as timing_policy,
       scoring.roster_check_time(c) at time zone 'America/New_York' as checked_eastern
from scoring.latest_roster_checks c
join draft.owners o on o.id=c.owner_id
order by c.check_date desc, o.display_name;
```

New complete observations show `scheduled-observation-v2` and their actual completion
time. Legacy observations retain the fixed 4 a.m. interpretation, including existing
pause evidence and historical cap rules. An explicit later correction must preserve
the observation timing policy belonging to its original evidence.

## Enable after reviewing and pushing the code

1. In Codespaces run:

   ```bash
   cd /workspaces/MultiSportFantasy2
   git pull --ff-only origin main
   cd supabase/tests
   npx --yes pnpm@11.25.0 test:daily-scoring-checks
   node trade-roster-sync.test.mjs
   ```

2. Confirm the existing `TRADE_ROSTER_PROJECT_REF` points at the intended test
   project and its scoring migration is applied. Do not enable against an
   unprepared production database.
3. In GitHub → repository Settings → Secrets and variables → Actions → Variables,
   add `SCORING_ROSTER_CHECKS_ENABLED` = `true`. Existing
   `TRADE_ROSTER_SYNC_ENABLED` must also be `true` with working connection secrets.
4. Wait for the next scheduled **roster** run (requested at 4 a.m. Eastern, but allowed to run late). The sync output now
   contains `scoring_checks`, the check date and each owner's status. A manually
   dispatched refresh intentionally cannot create or replace that checkpoint.
5. In the test project's SQL editor, inspect:

   ```sql
   select c.check_date,o.display_name,c.complete,c.total_players,c.revision,c.recorded_at
   from scoring.latest_roster_checks c
   join draft.owners o on o.id=c.owner_id
   order by c.check_date desc,o.display_name;
   ```

To disable new capture, set `SCORING_ROSTER_CHECKS_ENABLED` to `false`; existing
check history remains. This does not publish points or apply website penalties.

## Evidence and failure behavior

- Counts include every player in the validated roster snapshot, including IR and
  minors. Complete five-sport membership, identity, duplicate, freshness and
  database renewal checks are inherited from the existing roster importer.
- Store each sport's actual fetch-start timestamp and a source checksum. A
  complete checkpoint requires all starts AND the last file completion to share
  the same Eastern calendar date. The completion timestamp determines cap and pause policy. DST is handled using `America/New_York`.
- A same-date late scheduled run is valid evidence. Cross-date reads are skipped. A missing/failed fetch leaves no
  checkpoint, so eligibility remains pending. Nothing backfills invented counts.
- Exact retries return the existing check. Different later observations preserve
  the original checkpoint and report `existing_check_preserved`; they never
  silently replace the roster that determined that day's eligibility. Explicit
  administrative correction remains a separate reviewed operation.
- Count writes share the trade/membership lock followed by the scoring lock.
  A failure rolls back the whole database transaction, including reconciliation.
  Existing behavior is unchanged while the feature flag is off.
- Daily sports use the next day's actual scheduled observation date. PGA uses Thursday and Sunday dates.
  These rows are evidence only; the previously tested evaluator handles policy.

## Missing scoring records: required evidence before publishing

Update, 2026-10-29: Doug confirmed non-participation for all six missing starters
listed below, on these exact dates/period. The audited correction is implemented
and tested locally; see the non-participation section of `SCORING_IMPORT.md` for
preview/import commands. Original raw blanks remain preserved. Bench omissions
remain unknown, and historical roster-cap eligibility remains pending.

These are omissions in the actual captured per-player stats, not parser-invented
zeros. The captured team totals reconcile, but missing starter contributions
cannot be finalized merely from that fact.

| Example | Missing starters | Missing bench records |
|---|---|---|
| MLB Doug Sep 24, 2026 | Willson Contreras, Nick Kurtz | None |
| NFL Ryan Oct 25, 2026 | None | None |
| NBA Hatch Oct 23, 2026 | Bronny James | None |
| EPL Doug Oct 25, 2026 | None | Mack Allan |
| PGA Brendan Canadian Open period 21 | Ludvig Aberg, Dustin Johnson, Jordan Spieth | Anders Albertson, Byeong Hun An, Sungjae Im |

The PGA response explicitly records 127 for Viktor Hovland and no stats entries
for the other six players. This does not establish whether the others had no
activity, zero points, or omitted data. The previous MLB no-play confirmation
was for September 23, so it must not be assumed to cover September 24.

For each unresolved starter, provide the matching Fantrax scoring screen in Fpts
mode, with the owner and exact date/tournament visible, showing that player's
individual value or confirmed non-participation. If the screen shows points
missing from the diagnostic, capture the paired Network request payload and
response after that screen loads. Do not invent a different request parameter.
Bench omissions never add to team contribution, but remain explicitly unknown
in raw player data.

No blanket missing-to-zero conversion or website scoring publication is enabled.
Once paired evidence resolves these cases, add source-backed fixtures and an
audited correction path; ordinary import files must not silently mark unknown
records as proven no-activity.
