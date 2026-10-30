# Shared historical scoring diagnostic

This is read-only diagnostic functionality. It does not import production data,
apply penalties, finalize tournaments, schedule jobs, or write to Fantrax/Supabase.
Existing MLB diagnostics and all production importers remain unchanged.

## Run in Codespaces

Transfer the new files first. Set FANTRAX_COOKIE privately in the same terminal.
No database settings or runtime connection registry are needed. Defaults are pinned
to the historical leagues and examples below, including the OLD MLB league.

```bash
cd /workspaces/MultiSportFantasy2
PYTHONPATH=scripts python -m unittest test_diagnose_scoring test_diagnose_mlb_scoring
python scripts/diagnose_scoring.py --sport MLB --live
python scripts/diagnose_scoring.py --sport NFL --live
python scripts/diagnose_scoring.py --sport NBA --live
python scripts/diagnose_scoring.py --sport EPL --live
python scripts/diagnose_scoring.py --sport PGA --live
```

Additional previously reported MLB examples:

```bash
python scripts/diagnose_scoring.py --sport MLB --live --date 2026-09-23
python scripts/diagnose_scoring.py --sport MLB --live --date 2026-09-25
python scripts/diagnose_scoring.py --sport MLB --live --date 2026-09-23 --team-id y7t2k7ypmvhgidn7 --owner Billy
```

Each command makes one read-only two-message `/fxpa/req?leagueId=...` request,
with a 30-second timeout, verified TLS and redirects disabled. It prints normalized
JSON only. Do not share cookies/headers. Errors name the processing stage and use
allowlisted validation messages; raw API/transport errors are withheld.

Offline example:

```bash
python scripts/diagnose_scoring.py --sport PGA --response scripts/fixtures/scoring/pga.json
```

Date overrides apply only to daily sports; `--period` applies only to PGA. Team ID
and exact owner name must be provided together. These are explicit test targets,
not discovery or coverage of every league owner. Returned date/period, owner, team,
view and both ACTIVE/BENCH groups must match. The league ID comes from the pinned
request context, not an independently verified field in the scoring response.

## Evidence and provenance

All files under `scripts/fixtures/scoring/` are minimized actual responses, not
invented responses. They retain selected scope, relevant team identity, player
IDs/names, points, totals and completion information. Unrelated owners, client
identifiers, images, projections and unrelated summary-response content are removed.
Aggregate stats rows are retained to test that they are not double-counted.

| Fixture | Owner / scope | Starter / bench total | Original attachment ID |
| --- | --- | --- | --- |
| mlb.json | Doug, 2026-09-24 | 1 / 2 | 0d4ff2cd-85a2-4ad1-bb76-033a4b86ab75 (existing minimized MLB fixture) |
| nfl.json | Ryan, 2026-10-25 | 20.45 / 25.35 | e51dbd49-d3e5-4f21-8b58-2642278961fc |
| nba.json | Hatch, 2026-10-23 | 124 / 8 | 5781dac3-2b80-44c4-81dc-5b37b12c62af |
| epl.json | Doug, 2026-10-25 | 8 / 0 | eb365f36-065a-4165-b4f2-348b7071dcb1 |
| pga.json | Brendan, period 21, RBC Canadian Open | 127 / 0 | afcaa278-6001-493f-b9a7-9c60d50ff6f6 |

Doug's September 23/25 and Billy's September 23 results were supplied as normalized
live diagnostic outputs, not full raw responses. They are NOT reconstructed as raw
fixtures. Reported starter/bench totals are 10/10, 4/19 and 6/0 respectively. The
commands above reproduce these targets; raw responses would be needed for additional
real parser fixtures. Historical lineup verification was confirmed by the user,
but its paired raw evidence is not included in this fixture set.

Request definitions use the captured `getLiveScoringStats` plus
`getScoresSummaryData` full-view patterns. NFL uses the captured October 22 request
shape with the explicit October 25 target supported by its response. NBA/EPL/PGA
use the full requests pasted with their respective responses. EPL omits
playerViewType exactly as captured and validates the returned value is 2. RefUrl
is aligned to the requested scope rather than retaining the previous UI selection.
No background refresh flags or speculative methods are introduced.

## Output and limitations

- Common records retain sport, league/team/owner, stable player identity, date or
  tournament period, lineup group, raw points and starter-only contribution.
- Bench contribution is zero even if its raw points are missing. Missing starter
  scores remain null; explicit zeros and negative points remain numeric.
- Counts/list of missing stat rows are printed. Reconciliation does not prove that
  a missing row means zero or no activity. The user confirmed non-participation
  only for specific MLB examples; that finding is not generalized to every sport.
- Daily examples require allEventsFinished=true. PGA has no such field in this
  capture; completion_status is unverified. This is an explicit diagnostic exception,
  NOT approval to finalize or publish PGA scores. An explicit false is rejected.
- PGA stays tournament-scoped with a period label; no daily allocation is inferred.
- All outputs have historical_test_data=true and production_ready=false. No
  championship year is assigned and none of this pre-launch evidence awards titles.
- Numerical totals must reconcile within 1e-8. Missing groups, wrong scope/identity,
  duplicate IDs, unidentified stats, nonfinite values and API errors are rejected.
- New live replay for NFL/NBA/EPL/PGA remains to be performed in Codespaces. Offline
  fixture success is not live replay success. Negative/zero/invalid response tests
  use explicitly synthetic mutations. A later production importer still needs
  correction handling, complete owner coverage and delayed-result handling.

## Agreed rules for later implementation (NOT enforced here)

- Cap: 80 players (historical checks before policy activation retain 65) combined across all five sports, including IR and minors.
- Scheduled daily roster pulls determine counts at their actual run time, even when delayed from 4 a.m. America/New_York.
- NFL/MLB/NBA/EPL: that check determines the previous calendar day's eligibility.
- PGA: finalize tournament scoring Tuesday at 8 a.m. America/New_York.
- PGA: apply a tournament penalty only if over cap at BOTH Thursday and Sunday
  scheduled checks associated with that tournament. Either compliant check prevents it.
- Remove positive starter contributions individually; retain negative contributions.
- Missing/incomplete checks leave eligibility pending rather than inferring compliance.
- Commissioner may pause penalties; future storage must record effective pause times
  and reasons. Pause-boundary behavior across PGA's two checks needs an explicit
  policy before enforcement is implemented.
- The timestamp, complete roster snapshots and penalty decisions require future
  persistent storage; no such storage or timer is implemented by this diagnostic.
