import os
import json
import requests

LEAGUE_ID = "xa7tza2hmthqz8bo"

cookie_string = os.environ.get("FANTRAX_COOKIE")

if not cookie_string:
    raise RuntimeError("FANTRAX_COOKIE GitHub Secret is missing.")

session = requests.Session()

for cookie in cookie_string.split(";"):
    cookie = cookie.strip()

    if "=" not in cookie:
        continue

    name, value = cookie.split("=", 1)
    session.cookies.set(name.strip(), value.strip())

print("Fantrax cookies loaded.")
print(f"Testing league: {LEAGUE_ID}")

url = "https://www.fantrax.com/fxpa/req"

payload = {
    "msgs": [
        {
            "method": "getStandings",
            "data": {
                "leagueId": LEAGUE_ID
            }
        }
    ]
}

response = session.post(
    url,
    params={"leagueId": LEAGUE_ID},
    json=payload
)

print("Status code:", response.status_code)
print("Content type:", response.headers.get("content-type"))

try:
    data = response.json()

    print("\nFantrax JSON response:")
    print(json.dumps(data, indent=2)[:10000])

except Exception:
    print("\nCould not decode JSON.")
    print(response.text[:5000])
