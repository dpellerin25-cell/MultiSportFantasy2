import os
import json
import requests

NFL_LEAGUE_ID = "yg0olhfrmtj45dd6"

cookie_string = os.environ.get("FANTRAX_COOKIE")

if not cookie_string:
    raise ValueError("FANTRAX_COOKIE is not set")

session = requests.Session()

for item in cookie_string.split(";"):
    if "=" in item:
        name, value = item.strip().split("=", 1)
        session.cookies.set(name, value)

url = "https://www.fantrax.com/fxpa/req"

payload = {
    "msgs": [
        {
            "method": "getStandings",
            "data": {
                "leagueId": NFL_LEAGUE_ID
            }
        },
        {
            "method": "getTeamRosterInfo",
            "data": {
                "leagueId": NFL_LEAGUE_ID
            }
        }
    ]
}

response = session.post(
    url,
    params={"leagueId": NFL_LEAGUE_ID},
    json=payload,
)

print("Status:", response.status_code)

try:
    data = response.json()

    print(
        json.dumps(
            data,
            indent=2
        )[:100000]
    )

except Exception:
    print(response.text[:100000])
