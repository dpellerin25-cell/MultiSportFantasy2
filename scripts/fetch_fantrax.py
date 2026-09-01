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

for row in standings_table["rows"]:
    fixed_cells = row["fixedCells"]
    stat_cells = row["cells"]

    team = {
        "rank": int(fixed_cells[0]["content"]),
        "team": fixed_cells[1]["content"],
        "team_id": fixed_cells[1]["teamId"],
        "fantasy_points": float(stat_cells[0]["content"]),
        "points_change": stat_cells[1]["content"],
        "fantasy_points_per_game": float(stat_cells[2]["content"]),
        "tournaments_played": int(stat_cells[3]["content"]),
        "waiver_order": int(stat_cells[4]["content"]),
        "points_behind_leader": float(stat_cells[5]["content"])
    }

    standings.append(team)

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
