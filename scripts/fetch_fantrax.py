import os
import json
import requests
from datetime import datetime, timezone


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

LEAGUES = {
    "NFL": {
        "league_id": "yg0olhfrmtj45dd6",
        "filename": "nfl.json"
    },
    "MLB": {
        "league_id": "60ri2nbhmtj4b0km",
        "filename": "mlb.json"
    },
    "NBA": {
        "league_id": "u1byx3qkmtj47ogg",
        "filename": "nba.json"
    },
    "Premier League": {
        "league_id": "j08ymyupmtj415q3",
        "filename": "premier-league.json"
    },
    "PGA": {
        "league_id": "xa7tza2hmthqz8bo",
        "filename": "pga.json"
    }
}

FANTRAX_URL = "https://www.fantrax.com/fxpa/req"


# ---------------------------------------------------------
# CREATE AUTHENTICATED SESSION
# ---------------------------------------------------------

def create_session():
    cookie_string = os.environ.get("FANTRAX_COOKIE")

    if not cookie_string:
        raise RuntimeError(
            "FANTRAX_COOKIE environment variable is missing."
        )

    session = requests.Session()

    for cookie in cookie_string.split(";"):
        cookie = cookie.strip()

        if "=" not in cookie:
            continue

        name, value = cookie.split("=", 1)

        session.cookies.set(
            name.strip(),
            value.strip()
        )

    return session


# ---------------------------------------------------------
# FETCH ONE FANTRAX LEAGUE
# ---------------------------------------------------------

def fetch_league(session, sport, league_id):

    print()
    print("=" * 60)
    print(f"Fetching {sport}")
    print(f"League ID: {league_id}")
    print("=" * 60)

    payload = {
        "msgs": [
            {
                "method": "getStandings",
                "data": {
                    "leagueId": league_id
                }
            }
        ]
    }

    response = session.post(
        FANTRAX_URL,
        params={"leagueId": league_id},
        json=payload,
        timeout=30
    )

    response.raise_for_status()

    data = response.json()

    # Check for Fantrax-level errors
    if "error" in data:
        raise RuntimeError(
            f"Fantrax returned an error for {sport}: {data['error']}"
        )

    responses = data.get("responses", [])

    if not responses:
        raise RuntimeError(
            f"No Fantrax response returned for {sport}"
        )

    standings_data = responses[0].get("data", {})

    return standings_data


# ---------------------------------------------------------
# FIND THE STANDINGS TABLE
# ---------------------------------------------------------

def find_standings_table(standings_data):

    tables = standings_data.get("tableList", [])

    # First try the table explicitly called "Standings"
    for table in tables:
        if table.get("caption") == "Standings":
            return table

    # Fall back to anything with rows and team columns
    for table in tables:

        fixed_header = table.get(
            "fixedHeader", {}
        ).get(
            "cells", []
        )

        fixed_keys = [
            cell.get("key")
            for cell in fixed_header
        ]

        if (
            "team" in fixed_keys
            and table.get("rows")
        ):
            return table

    return None


# ---------------------------------------------------------
# EXTRACT TEAM METADATA
# ---------------------------------------------------------

def extract_team_info(standings_data):

    raw_team_info = standings_data.get(
        "fantasyTeamInfo",
        {}
    )

    teams = {}

    for team_id, team in raw_team_info.items():

        teams[team_id] = {
            "team_id": team_id,
            "name": team.get("name"),
            "short_name": team.get("shortName"),
            "logo_url": team.get("logoUrl512")
        }

    return teams


# ---------------------------------------------------------
# CONVERT A FANTRAX TABLE TO CLEAN JSON
# ---------------------------------------------------------

def parse_standings_table(table):

    header_cells = table.get(
        "header", {}
    ).get(
        "cells", []
    )

    stat_keys = []

    for index, cell in enumerate(header_cells):

        key = cell.get("key")

        if not key:
            key = f"stat_{index}"

        stat_keys.append(key)

    standings = []

    for row in table.get("rows", []):

        fixed_cells = row.get(
            "fixedCells",
            []
        )

        stat_cells = row.get(
            "cells",
            []
        )

        if len(fixed_cells) < 2:
            continue

        rank_cell = fixed_cells[0]
        team_cell = fixed_cells[1]

        team_data = {
            "rank": rank_cell.get("content"),
            "team": team_cell.get("content"),
            "team_id": team_cell.get("teamId")
        }

        # Dynamically attach whatever stats Fantrax provides.
        # This prevents different sports from breaking the script.
        for index, cell in enumerate(stat_cells):

            if index < len(stat_keys):
                key = stat_keys[index]
            else:
                key = f"stat_{index}"

            team_data[key] = cell.get("content")

        standings.append(team_data)

    return standings


# ---------------------------------------------------------
# WRITE ONE SPORT TO JSON
# ---------------------------------------------------------

def save_league_json(
    sport,
    league_id,
    filename,
    standings_data
):
    table = find_standings_table(standings_data)

    if table is None:
        raise RuntimeError(
            f"Could not find standings table for {sport}"
        )

    standings = parse_standings_table(table)
    team_info = extract_team_info(standings_data)

    league_heading = (
        standings_data
        .get("miscData", {})
        .get("heading")
    )

    output = {
        "sport": sport,
        "league_id": league_id,
        "league_name": league_heading,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "team_count": len(standings),
        "teams": team_info,
        "standings": standings
    }

    os.makedirs(
        "web/data",
        exist_ok=True
    )

    filepath = os.path.join(
        "web",
        "data",
        filename
    )

    with open(
        filepath,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            output,
            file,
            indent=2,
            ensure_ascii=False
        )

    print(f"SUCCESS: Created {filepath}")
    print(f"Teams found: {len(standings)}")

    for team in standings:
        print(
            f"  {team.get('rank')} - "
            f"{team.get('team')}"
        )

# ---------------------------------------------------------
# MAIN PROGRAM
# ---------------------------------------------------------

def main():

    print("Starting Fantrax multi-sport update...")

    session = create_session()

    print("Fantrax cookies loaded.")

    successful = []
    failed = []

    for sport, config in LEAGUES.items():

        try:

            standings_data = fetch_league(
                session,
                sport,
                config["league_id"]
            )

            save_league_json(
                sport,
                config["league_id"],
                config["filename"],
                standings_data
            )

            successful.append(sport)

        except Exception as error:

            print()
            print(
                f"ERROR fetching {sport}:"
            )

            print(
                f"{type(error).__name__}: {error}"
            )

            failed.append({
                "sport": sport,
                "error": str(error)
            })

    print()
    print("=" * 60)
    print("UPDATE SUMMARY")
    print("=" * 60)

    print(
        f"Successful: {len(successful)}"
    )

    for sport in successful:
        print(f"  ✓ {sport}")

    print(
        f"Failed: {len(failed)}"
    )

    for failure in failed:
        print(
            f"  ✗ {failure['sport']}: "
            f"{failure['error']}"
        )

    # Cause GitHub Action to fail if ANY league failed.
    # We don't want to silently publish incomplete standings.
    if failed:
        raise RuntimeError(
            f"{len(failed)} league(s) failed to update."
        )

    print()
    print(
        "All five Fantrax leagues updated successfully!"
    )


if __name__ == "__main__":
    main()
