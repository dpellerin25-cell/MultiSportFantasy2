# Initial daily MLB scoring diagnostic

Read-only, fixed replay of the user-captured `getLiveScoringStats` and
`getScoresSummaryData` request for Doug, September 24, 2026, old MLB league
`60ri2nbhmtj4b0km`. League ID uses the existing `/fxpa/req?leagueId=...` pattern.
The captured refUrl mentions September 23; the actual data.date and response
displayedSelections.date both specify September 24. The request is preserved.

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
must still reproduce the captured example before extending the importer.
