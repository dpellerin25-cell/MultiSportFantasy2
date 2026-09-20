# Trophy Case

The `/trophy-case` page derives titles from the existing configured seasons and
archived standings. It does not maintain a second list of manually entered winners.
There are currently no final archived sports, so no trophies have been awarded.

## Award rules

- A sport must be marked `final` in `src/config/seasons.ts`. Only then does the
  existing `getSeasonLeagueData` loader read `data/history/<year>/<sport>.json`.
  Live and upcoming standings are never used for awards.
- The archive must match the sport and contain all nine owners, unique names and
  team IDs, valid ranks from 1–9, finite fantasy points, and a first-place result.
  EPL accepts the updater's `Premier League` sport label and filename.
- The sport champion is the **only owner ranked first** in that final archive.
  This follows the final standings rather than awarding by adjusted sport score.
- The overall champion is awarded only when all five sports have valid final
  archives with the same owner names. The existing `scoreLeague` function provides
  each sport's placement points plus 10 × z-score. Those five unrounded scores are
  summed, exactly as on the overall standings page.
- A tied first place or overall score is left unawarded and visibly flagged.
  Overall differences of at most 1e-9 are treated as floating-point ties, not an
  invented league tiebreaker. No alphabetical selection or co-champions are used.
  Resolve official ties under the league's agreed rules before extending award
  handling; do not alter raw fantasy points just to force a trophy winner.
- Missing or invalid archives are flagged in championship history. Valid individual
  sport trophies can still be awarded while other sports are incomplete.
- Every awarded title counts as one trophy. All-time owner totals include overall
  and sport titles. Current NFL names seed the zero-trophy owner cards; historical
  archive names remain included. Consistent names across sports remain important,
  as in the existing overall standings system.

## Completing the first championship

1. Confirm the Fantrax snapshot represents the official final results, including
   the sport's actual champion. If a sport uses playoffs, verify that the archived
   standings rank reflects the champion; the app cannot infer a playoff winner.
2. From the repository root, archive each completed sport using the existing tool:

   ```sh
   python scripts/archive_season.py 2027 NFL
   python scripts/archive_season.py 2027 MLB
   python scripts/archive_season.py 2027 NBA
   python scripts/archive_season.py 2027 "Premier League"
   python scripts/archive_season.py 2027 PGA
   ```

   Run a sport's command only after that sport finishes. The script protects existing
   snapshots against accidental replacement and writes its existing archive metadata.
3. Set each completed sport's status to `final` in `web/src/config/seasons.ts`.
   Keep old championship entries in that configuration when adding new years.
4. Refresh Trophy Case locally. Each eligible sport trophy appears automatically;
   the overall trophy appears once all five valid final archives are present.
5. For the hosted site, include the archives and configuration in your normal future
   deployment. This task does not publish or change deployment settings.

Archive metadata supplies audit timestamps but is not a second completion flag:
the explicit season `final` status plus the archived results determine eligibility.
The Trophy Case never modifies archives or the Fantrax updater. It reads per request,
so local archive updates are visible on refresh without maintaining a winners list.

## Verification

`node --test tests/trophies.test.mjs` exercises synthetic data in memory only,
covering incomplete seasons, ties, invalid archives, owner matching, and totals.
Run the normal lint and production build checks as well.
