# Billy: eleven-owner rollout

Approved current membership and placement points are in `web/data/league-settings.json`:
Billy, Brendan, Chris, Doug, Hatch, Jack, Jacob, John, Nik, Ryan, Tucker.
Points: 100, 83, 70, 59, 49, 40, 32, 24, 16, 8, 0.
The constitution matches. Historical archives and their scoring remain unchanged.
Current scores use this table; missing Fantrax results remain blank, not invented.

## Hosted steps still required

1. In the intended Supabase-backed site's commissioner League Settings, add Billy
   (slug `billy`, display name `Billy`) and enter the eleven placement values.
   Review the proposal and blockers, then confirm. Repeat independently for the
   test and production environments as appropriate; local JSON does not update Supabase.
2. A started/paused rehearsal draft may block expansion. Do not bypass that guard
   or delete existing selections/trades. Decide how that draft should be retained
   and plan a separate supported cleanup/replacement before applying membership.
3. Link Billy's confirmed account to his owner identity using the existing account
   setup process. No commissioner grant is needed. His email is still required.
4. Choose the eleven-owner startup order before creating a new draft: 80 rounds
   means 880 picks. Existing drafts are not resized. The membership command creates
   the normal ten picks per owner for each of the two configured rookie years:
   110 picks per year, 220 total, preserving existing traded ownership.
5. Refresh all five Fantrax roster snapshots after database membership is aligned.
   Run standings refresh on the approved active connections. An old unrenewed
   connection can still have different membership even if the new league has Billy.
6. Re-export the runtime registry and obtain fresh renewal evidence after membership
   changes. Resolve MLB player identity differences separately before activation.

No new database schema is needed: existing membership commands support eleven
owners. No live accounts, database membership, snapshots or drafts were modified
by this local change. No extra expansion-draft, compensation or retroactive player
allocation rules have been assumed. Decide those only if the real league has
already drafted or begun scoring; otherwise Billy receives the standard allocation.
