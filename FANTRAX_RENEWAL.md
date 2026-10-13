# MLB renewal discovery

Diagnostic only: no website configuration, saved standings, rosters, or Supabase
rows are changed. Targets old MLB 60ri2nbhmtj4b0km and new MLB rk8bvnk3mulovx9a.

Request evidence: https://github.com/pmurley/go-fantrax#retrieve-league-list
and https://github.com/pmurley/go-fantrax#retrieve-league-info. These are third-party
bindings describing Fantrax's beta API, not a guarantee of current availability.
The endpoint response and renewal metadata must still be validated live.

Transfer scripts/diagnose_league_renewal.py and its offline test to Codespaces.
In Fantrax's User Profile, look for the User Secret ID described by the source.
If absent, stop; do not substitute your password, league ID or cookie.
Enter it privately using the hidden terminal prompt (never in chat):

```bash
cd /workspaces/MultiSportFantasy2
read -rsp 'Fantrax User Secret ID: ' FANTRAX_USER_SECRET_ID
printf '\n'
export FANTRAX_USER_SECRET_ID
python scripts/diagnose_league_renewal.py > /tmp/mlb-renewal-diagnostic.json
unset FANTRAX_USER_SECRET_ID
cat /tmp/mlb-renewal-diagnostic.json
```

Uses the existing requests dependency. Does not require FANTRAX_COOKIE. Fixed
HTTPS GET requests only, no redirects, no retries and no authentication fallback.
The secret is supplied as the documented query parameter to Fantrax; exceptions
and request URLs are never printed. Do not enable HTTP debug logging.

Review the resulting report before sharing. It filters credentials, email and
URL fields, but league metadata can still be private. It prints metadata paths
rather than assuming a schema. HTTP 200 alone is not a successful validation.
No renewal relationship is declared verified automatically, even if both IDs
appear. Results are capped and identify truncation.

If either request fails or no season/linkage metadata is present, capture the
read-only request and response when loading My Leagues and switching between the
old/new seasons in Fantrax Network tools. Remove Cookie/Authorization headers and
secret query values before sharing. Do not capture or execute a renewal action.

Offline tests:
python -m unittest discover -s scripts -p test_diagnose_league_renewal.py
