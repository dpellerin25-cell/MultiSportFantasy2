# Fantrax player-pool investigation

## Follow-up: a supported diagnostic request

The user's subsequent NFL browser capture explicitly calls `getPlayerStats`
with `positionOrGroup: "POS_100"` and `pageNumber: "1"`. Its Jared Goff row
includes a waiver tooltip. This proves the method, but not all-position coverage.

Independent client documentation corroborates the request:
https://pkg.go.dev/github.com/pmurley/go-fantrax/auth_client#GetPlayerPoolRequest
defines `statusOrTeamFilter`, `maxResultsPerPage`, and string `pageNumber`.
Its constants define `ALL_AVAILABLE` as free agents plus waiver players.
This is third-party implementation evidence, not an official Fantrax contract.
The response model documents `paginatedResultSet` and `statsTable`:
https://pkg.go.dev/github.com/pmurley/go-fantrax/models#PlayerPoolResponseData

The configured Python runtime has neither requests nor fantraxapi installed.
Inspection of the upstream FantraxAPI League source found roster/standings
helpers but no player-pool helper there:
https://github.com/meisnate12/FantraxAPI/blob/master/fantraxapi/objs/league.py
No Fantrax web bundle was needed to identify the evidenced read method.

`scripts/diagnose_nfl_players.py` makes one request to the existing endpoint,
using the NFL league ID query parameter and FANTRAX_COOKIE. It requests
ALL_AVAILABLE and prints the whole decoded JSON response without extracting
or discarding the envelope. It does not specify a position filter: the server's
effective default must be inspected, not assumed to include all NFL positions.
There is no automatic pagination, no data-file output, and no write method.

In a Python environment with requests installed and FANTRAX_COOKIE set privately:

```powershell
python scripts/diagnose_nfl_players.py
python scripts/diagnose_nfl_players.py --page 2
python -B -m unittest discover -s scripts -p test_diagnose_nfl_players.py -v
```

If needed, install requests using `python -m pip install requests`. Inspect the
raw response locally before sharing it; it may contain league/account metadata.
Diagnostics and errors go to stderr, raw JSON goes to stdout. HTTP/JSON failures,
redirects, and recognized API error envelopes exit nonzero. A successful envelope
does not establish successful authentication, availability mapping, or completeness.

Live execution remains blocked by the missing local cookie. Next inspect the
returned filter/position selections, player table headers, and pagination metadata
before designing a complete NFL importer. The earlier findings below describe
the initial repository-only investigation and capture fallback.

## What is verified in this repository

`scripts/fetch_fantrax.py` uses a requests session authenticated by the
`FANTRAX_COOKIE` environment variable. It posts to
`https://www.fantrax.com/fxpa/req?leagueId=<league_id>` with this envelope:

```json
{"msgs": [{"method": "<observed method>", "data": {}}]}
```

Only two methods are evidenced here:

- `getStandings`, with `leagueId`: supplies standings and `fantasyTeamInfo`.
- `getTeamRosterInfo`, with `leagueId`, `teamId`, and `view: "SIMPLE"`:
  supplies players already on a fantasy team's roster.

The updater loops through the fantasy teams supplied by standings, then parses
`tables[].rows[].scorer`. Empty roster slots are skipped. Its known player
fields are `scorerId`, `name`, `posShortNames`, `teamShortName`, and `teamName`.
`row.statusId` is stored without interpreting it; it is NOT verified as a
free-agent/waiver eligibility indicator.

`scripts/test_rosters.py` is an authenticated NFL diagnostic using the same two
methods, not an offline test suite. `requirements.txt` lists `fantraxapi`, but
the project scripts call `requests` directly instead of that package's API.

The GitHub workflow runs the updater daily at 09:00 UTC and manually, supplies
the cookie from a secret, and commits `web/data/`. No player-pool importer is
connected to that workflow.

| Sport | League ID |
| --- | --- |
| NFL | yg0olhfrmtj45dd6 |
| MLB | 60ri2nbhmtj4b0km |
| NBA | u1byx3qkmtj47ogg |
| Premier League | j08ymyupmtj415q3 |
| PGA | xa7tza2hmthqz8bo |

## Current blocker

There is no available-player request, captured response, pagination example,
or documented availability mapping in the repository. The local process has
no FANTRAX_COOKIE configured. No undocumented request was guessed or sent.

The existing roster snapshots contain one NFL player (Josh Allen), and zero
players for the other four sports. These snapshots are not the available-player
pool. Fetching every roster would still not enumerate unrostered players.

## Browser Network captures needed

Repeat these steps inside EACH of the five leagues, while signed in to Fantrax:

1. Open Developer Tools (F12), select Network, select Fetch/XHR, and clear the
   log. Keep the log recording before opening the league's player search page.
2. Select the UI option for available players/free agents. Clear the search
   text and select all positions and all professional teams. Record the exact
   filter labels/values and any displayed result count. Record whether injured,
   inactive, minor-league, prospect, or other player categories are excluded.
3. Inspect the request whose response contains the visible player names. The
   existing integration uses `fxpa/req`, so start by filtering for that URL, but
   do not assume the player screen must use the same endpoint. Provide:
   - HTTP method, URL, and query parameters;
   - the complete JSON request payload, including every batched message;
   - the matching JSON response, including surrounding metadata and headers
     within the response body, not just individual player rows;
   - any non-secret header names required by the request. Do not include cookie,
     authorization, session, or CSRF token values.
4. Advance to the second page or scroll until another group loads. Capture its
   request and response too. Also capture the final page/end-of-list response
   and the displayed total. If changing page size triggers a request, capture
   that as well. These establish offset/cursor behavior and termination.
5. If separate filters exist for free agents, waivers, rostered, and all players,
   capture each relevant filter's request and a response containing examples.
   Record the UI availability label for each example player so opaque status
   codes can be mapped correctly. Do not add, drop, claim, or draft anyone.
6. For PGA, include an example without a professional team if present; for
   sports with multi-position players, include one of those examples. Preserve
   player IDs and field types in the sanitized responses.

Use names such as `nfl-free-agents-page1-request.json` and
`nfl-free-agents-page1-response.json`, repeating for the other sports and pages.
Keep raw HAR files and copied cURL commands private: they can contain credentials
and unrelated account information. Share sanitized payloads/responses instead.
For a later local replay, configure the cookie privately in FANTRAX_COOKIE;
do not put it in source code or the captured examples.

If there are no pagination controls, capture initial load plus the requests
triggered by scrolling and explain what the UI reports for the full count.
We must distinguish a genuinely complete response from a partial first page.

## Proposed normalized contract (not yet a verified pool response)

```json
{
  "player_id": "04mnz",
  "player_name": "Josh Allen",
  "sport": "NFL",
  "position": "QB",
  "professional_team": "BUF",
  "availability_status": "rostered",
  "league_id": "yg0olhfrmtj45dd6"
}
```

This example is mapped from the existing NFL ROSTER snapshot, not a free-agent
fetch. `rostered` follows from membership in that roster, not from interpreting
`status_id`. There are no real MLB, NBA, Premier League, or PGA player examples
in the current snapshots; none have been fabricated.

Use `league_id` + `player_id` as the import identity. Preserve IDs as strings.
Proposed availability values are `free_agent`, `waivers`, `rostered`, and
`unknown`, pending the captured evidence. Unknown status must not be treated as
draftable. A missing professional team can be null (particularly in PGA).
Confirm position representation from all five responses before implementing
normalization; do not assume a single position or use a fantasy owner as the
professional team.

## Minimum implementation after captures

Add a standalone, explicitly invoked diagnostic/import script with no changes
to the existing updater or website. Replay only the verified read request,
using the configured league IDs and authenticated session. Import every page
with a fixed filter set, detect repeated cursors/pages and conflicting duplicate
IDs, and reconcile unique player counts against the response/UI total where
provided. Stop with an error on authentication failures, nested API errors,
malformed responses, or uncertain pagination rather than report a partial pool
as complete. Bounded retries/backoff can handle transient failures.

Keep diagnostic output outside `web/data/`; the current workflow stages that
whole directory. Include source league, filters, capture/fetch time, page count,
unique count, and completeness evidence with normalized results. Preserve raw
availability values for diagnosis. Roster cross-checking is useful but cannot
by itself distinguish waivers from free agents or prove completeness.

Test against sanitized real response fixtures for each sport, multiple/final
pages, empty pools, missing team/position fields, duplicate IDs, API errors,
and authentication failures. Then run a read-only live import for all five
leagues, compare counts and sample player statuses with the Fantrax UI, and
repeat to check stability. Offline fixtures alone do not prove live retrieval.

No draft UI, database, authentication system, or Fantrax write operation is
needed for this diagnostic phase.
