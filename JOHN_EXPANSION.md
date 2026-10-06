# John: ten-owner activation

Current website membership includes John and placement points are
100, 82, 68, 56, 45, 35, 26, 18, 10, 0.
Existing saved Fantrax files still contain nine teams. Missing results are not
fabricated; the website marks scores provisional until refreshed. Historical
archives keep their original rules and results.

1. In each of the five Fantrax leagues, John's team display name must be `John`.
   The importer discovers team IDs from getStandings; do not invent IDs or edit
   the saved JSON to simulate results.
2. In League Settings, add owner slug `john`, name `John`, and the above placement
   table for 2027. Review and apply. This is required separately from the website
   configuration for Supabase rookie picks, trade rosters, and email recipients.
   If an existing rehearsal draft blocks membership changes, stop and review the
   blocker with Doug. Do not bypass the protection or rewrite an active draft.
3. Link John's authenticated account to his new owner identity using the same
   established account-linking process. Do not grant commissioner permissions.
4. Transfer the local changes to GitHub when ready. Manually run Update Fantrax
   Data once for standings and once for rosters. These runs use FANTRAX_COOKIE
   already stored in GitHub Secrets; schedules remain unchanged.
5. Confirm all five files report ten teams, John has his actual results/roster,
   Supabase roster synchronization succeeds and John's picks show publicly.
   New startup drafts have 650 slots; a new draft must use an explicit ten-owner
   order. Existing historical draft slots are not changed.

No remote settings, Fantrax teams, accounts, or saved results were modified by
this local implementation. The importer intentionally rejects a missing or
mismatched owner instead of importing an incomplete league.
