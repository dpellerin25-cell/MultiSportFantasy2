import os
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


def fantrax_request(method, data):
    payload = {
        "msgs": [
            {
                "method": method,
                "data": data,
            }
        ]
    }

    response = session.post(
        url,
        params={"leagueId": NFL_LEAGUE_ID},
        json=payload,
    )

    response.raise_for_status()
    return response.json()


# --------------------------------------------------
# STEP 1: Get every fantasy team in the NFL league
# --------------------------------------------------

standings_response = fantrax_request(
    "getStandings",
    {
        "leagueId": NFL_LEAGUE_ID
    },
)

standings_data = standings_response["responses"][0]["data"]

fantasy_teams = standings_data.get("fantasyTeamInfo", {})

print()
print("NFL TEAMS FOUND")
print("=" * 50)

for team_id, team_info in fantasy_teams.items():
    print(f"{team_info.get('name')} -> {team_id}")


# --------------------------------------------------
# STEP 2: Pull each team's roster
# --------------------------------------------------

print()
print("NFL ROSTERS")
print("=" * 50)

for team_id, team_info in fantasy_teams.items():

    owner = team_info.get("name", "Unknown")

    roster_response = fantrax_request(
        "getTeamRosterInfo",
        {
            "leagueId": NFL_LEAGUE_ID,
            "teamId": team_id,
            "view": "SIMPLE",
        },
    )

    roster_data = roster_response["responses"][0]["data"]

    players = []

    for table in roster_data.get("tables", []):
        for row in table.get("rows", []):

            scorer = row.get("scorer")

            # Empty roster slots do not have a scorer
            if not scorer:
                continue

            players.append(
                {
                    "id": scorer.get("scorerId"),
                    "name": scorer.get("name"),
                    "position": scorer.get("posShortNames"),
                    "proTeam": scorer.get("teamShortName"),
                    "status": row.get("statusId"),
                }
            )

    print()
    print(f"{owner}: {len(players)} players")

    if players:
        for player in players:
            print(
                f"  - {player['name']} | "
                f"{player['position']} | "
                f"{player['proTeam']} | "
                f"status {player['status']}"
            )
    else:
        print("  (empty roster)")
