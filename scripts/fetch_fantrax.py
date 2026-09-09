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

response.raise_for_status()

data = response.json()

standings_data = data["responses"][0]["data"]

tables = standings_data["tableList"]

standings_table = None

for table in tables:
    if table.get("caption") == "Standings":
        standings_table = table
        break

if standings_table is None:
    raise RuntimeError("Could not find standings table.")

standings = []

# Get the stat column names directly from Fantrax
header_cells = standings_table.get("header", {}).get("cells", [])

stat_keys = [
    cell.get("key", f"stat_{i}")
    for i, cell in enumerate(header_cells)
]

print("Stat columns returned by Fantrax:")
print(stat_keys)

for row in standings_table["rows"]:
    fixed_cells = row.get("fixedCells", [])
    stat_cells = row.get("cells", [])

    if len(fixed_cells) < 2:
        continue

    team_data = {
        "rank": fixed_cells[0].get("content"),
        "team": fixed_cells[1].get("content"),
        "team_id": fixed_cells[1].get("teamId")
    }

    # Match each returned stat cell to its Fantrax header key
    for i, cell in enumerate(stat_cells):
        if i < len(stat_keys):
            key = stat_keys[i]
        else:
            key = f"stat_{i}"

        team_data[key] = cell.get("content")

    standings.append(team_data)

print("\nCLEAN STANDINGS:\n")

for team in standings:
    print(team)

with open("standings.json", "w") as f:
    json.dump(
        {
            "league_id": LEAGUE_ID,
            "sport": "PGA",
            "standings": standings
        },
        f,
        indent=2
    )

print("\nCreated standings.json")
