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
The supplied NFL/NBA/EPL/PGA diagnostic reported 2026, but did not include
start/end dates or identify which cross-year season that value represents.
Those offsets remain null. Test fixtures are synthetic, not additional evidence.
Until reviewed, their standings writes, archives and releases fail with an
explicit unverified-mapping error. Roster-only reads remain available.

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
  calendar mappings intentionally block that workflow until evidence is reviewed.
- Standings release and marking a sport final remain separate approval steps.

## Next steps in Codespaces — read-only evidence first

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

After reviewing that evidence, fill in the verified offsets and extend the SQL
mapping function in the pending migration to match. Only then run the migration
dry run and approved test-project deployment. Do not enable unattended switching
or apply `202610210001_championship_calendar.sql` to production yet.

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
