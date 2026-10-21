# Championship calendar correction

The Cup number is its **starting year**. Cup 2027 includes PGA/MLB 2027 and
NFL/NBA/EPL 2027–28, finishing in May 2028. Cup 2028 begins while Cup 2027 is
still running. The startup draft is planned for December 2026.

## Source and evidence

`web/data/championship-calendar.json` is shared by website labels and Python/Node
year conversion. League calendar years are not automatically assumed to be
Fantrax `seasonYear` values.

The user-supplied live MLB metadata reported old league `60ri2nbhmtj4b0km` as
2026 and renewed league `rk8bvnk3mulovx9a` as 2027, sharing history
`ml3fdlq2mulovxoh`. MLB's offset is verified as zero.
The subsequent user-supplied live date diagnostic confirmed all five sports:

| Sport | Fantrax seasonYear | startDate | endDate |
|---|---:|---|---|
| NFL | 2026 | 2026-09-09 | 2027-01-10 |
| MLB | 2027 | 2027-03-24 | 2027-09-26 |
| NBA | 2026 | 2026-10-20 | 2027-04-11 |
| EPL | 2026 | 2026-08-21 | 2027-05-30 |
| PGA | 2026 | 2026-01-15 | 2026-08-30 |

All offsets are zero: Fantrax names the season by its starting year. These dates
are evidence for the current leagues, not a prediction of future schedules.
The current NFL/NBA/EPL/PGA leagues remain pre-launch; do not archive their 2026
results as Cup 2027. Their future 2027 renewals need an initial-setup release.

## Changes and safeguards

- Website seasons 2027 and 2028 now have the intended labels and upcoming status.
  Set each sport live only when the correct league/season is approved and starts.
- Upcoming sports do not expose rehearsal standings. Live snapshots must match
  the requested championship year; final sports read only their own archive.
- Fresh standings verify the mapping before saving. Manual/scheduled archives
  reject pre-launch data. Existing JSON, archives and rankings are not rewritten.
- The old `+1` cross-year assumption was removed from archive and release tools.
  A new migration replaces the release functions with a verified-year guard.
  It changes functions only, not any saved league state or release history.
- Scoring formulas, placement tables, picks, player IDs and trades are unchanged.
- Renewal detection and roster policy remain automatic. The automatic workflow
  still requires its per-sport archive to succeed before handoff; unverified
  pre-launch seasons intentionally block normal championship archiving; use the explicit initial-setup transition for those leagues.
- Standings release and marking a sport final remain separate approval steps.

## Next steps in Codespaces — inspect stored state

After transferring the reviewed local changes, use the same configured test
connection and verified TLS settings as before:

```bash
cd /workspaces/MultiSportFantasy2
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
node supabase/tests/yearly-renewals.mjs export /tmp/fantrax-runtime.json
export FANTRAX_CONNECTIONS_FILE=/tmp/fantrax-runtime.json
python scripts/diagnose_season_dates.py > /tmp/fantrax-season-dates.json
cat /tmp/fantrax-season-dates.json
```

The Python diagnostic uses the existing FANTRAX_COOKIE approach and reads only
the already-used getLeagueInfo endpoint for the five configured leagues. If dates
are absent or do not establish the official sport season, also capture the league
settings page showing its season label. Do not infer from a league name alone.

Run `supabase/tests/preview-calendar-state.sql` in the **test** project's SQL
editor and share its result. This is read-only and reports existing state without
correcting or relabeling it. Do not modify the database based solely on a year
difference: a retained standings league may legitimately be an older season.

The date convention is now verified. Migration `202610210002_verified_sport_years.sql`
updates the guard for all five sports without changing saved data. Keep the prior
migration unchanged; apply both in order if neither is installed. Before applying,
review the read-only state report and run a test-project migration dry run. Neither
migration changes existing league IDs, standings years or results. Any incorrect
stored mapping still needs a separately reviewed correction. Do not deploy to
production or enable unattended switching until initial-setup transitions are ready.

## Local validation

```bash
PYTHONPATH=scripts python -m unittest test_championship_calendar test_archive_renewed_sports test_yearly_renewals test_fetch_update_modes
node supabase/tests/yearly-renewal.test.mjs
node --test --test-isolation=none web/tests/season-calendar.test.mjs
cd web
npm run build
```

Historical migration files and 2026 ranking source labels deliberately retain their
original dates. They are historical inputs, not current championship labels.
