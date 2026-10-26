# Initial daily MLB scoring diagnostic

Read-only diagnostic based on the user-captured `getLiveScoringStats` and
`getScoresSummaryData` request for Doug, September 24, 2026, old MLB league
`60ri2nbhmtj4b0km`. League ID uses the existing `/fxpa/req?leagueId=...` pattern.
The captured refUrl mentions September 23; the actual data.date and response
displayedSelections.date both specify September 24. That default request is preserved.
Other explicit dates/teams use the requested date in both places. The league
remains pinned to the old pre-launch MLB league; no production season is written.

Run with a privately configured FANTRAX_COOKIE in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
python scripts/diagnose_mlb_scoring.py --live
```

No database settings are needed. No files, database rows, website data or Fantrax
records are modified. The script makes one request, refuses redirects, and prints
only normalized results rather than raw responses or credentials.

Offline verification:

```bash
PYTHONPATH=scripts python -m unittest test_diagnose_mlb_scoring
python scripts/diagnose_mlb_scoring.py --response scripts/fixtures/mlb-scoring-2026-09-24.json
```

The fixture is a minimized subset of the actual supplied response, with client IDs,
unrelated teams, icons and other unnecessary fields removed. Expected active total
is 1 (Matt Olson), bench total is 2 (Freddie Freeman), bench contribution is zero.
Contreras/Kurtz are listed but have no stat rows; their points remain null.
Group subtotals such as `_10` are not additional players and are excluded.

Checks cover date/team/view, finished events, active/bench identities, duplicate
players, finite points and reconciliation with each group total. Negative active
points are preserved. No overage penalties are applied by this diagnostic.
Roster counts continue to come from the existing roster pull.

This proves only the captured daily example. It does not yet prove historical
Best Ball finalization, trade-date attribution, all-period completeness or other
sports. Missing stat rows are not automatically zero. A fresh authenticated run
successfully reproduced the captured example in Codespaces (user-supplied live
output). Local offline verification is separate from that authenticated test.

## Next live checks

After transferring the updated diagnostic, run with FANTRAX_COOKIE set privately:

```bash
cd /workspaces/MultiSportFantasy2
python scripts/diagnose_mlb_scoring.py --live --date 2026-09-24
python scripts/diagnose_mlb_scoring.py --live --date 2026-09-23
python scripts/diagnose_mlb_scoring.py --live --date 2026-09-25
```

The adjacent dates are test targets, not already validated scoring evidence.
Compare each result to Doug's historical Fantrax Day / Fpts view for the same
date: starters, bench players, individual points, and active/bench totals.
Keep missing stat rows unknown even when group totals reconcile. If Fantrax
displays zero for those players, capture that request and response so we can
verify whether a different view exposes explicit zero scores. Do not change
undocumented request flags by trial and error.

For another owner in this same old league, copy their teamId from the historical
scoring URL and their exact displayed name. Replace both placeholders:

```bash
python scripts/diagnose_mlb_scoring.py --live --date 2026-09-24 --team-id REPLACE_WITH_TEAM_ID --owner "REPLACE_WITH_OWNER_NAME"
```

Both arguments are required together. The response must match date, team ID and
owner name. Do not use a team ID from the renewed league. The next evidence
should cover multiple owners/dates and a historical lineup change; negative
points and explicit zeros are tested synthetically offline but still need live
examples. These checks do not yet establish Best Ball finalization or transfer-day
attribution. `production_ready: false` is intentional until these gaps are resolved.

The expanded offline suite covers parameterized requests, owner mismatch, explicit
zero versus missing scores, negative points, duplicate/unidentified players,
nonfinite values, incorrect dates/views, unfinished events and reconciliation.
No daily scheduling, penalty deductions or database writes are enabled.
