import math
import argparse
import os
import json
import requests
from datetime import datetime, timezone


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

from fantrax_connections import CONNECTIONS
LEAGUES = {('Premier League' if s == 'EPL' else s):
          {'league_id': v['current_league_id'], 'filename': v['filename'] + '.json'}
          for s, v in CONNECTIONS['sports'].items()}

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
# GENERIC FANTRAX REQUEST
# ---------------------------------------------------------

def fantrax_request(session, league_id, method, request_data):

    payload = {
        "msgs": [
            {
                "method": method,
                "data": request_data
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

    if "error" in data:
        raise RuntimeError(
            f"Fantrax returned an error: {data['error']}"
        )

    responses = data.get("responses", [])

    if not responses:
        raise RuntimeError(
            f"No Fantrax response returned for {method}"
        )

    return responses[0].get("data", {})


# ---------------------------------------------------------
# FETCH ONE FANTRAX LEAGUE
# ---------------------------------------------------------

def fetch_league(session, sport, league_id):

    print()
    print("=" * 60)
    print(f"Fetching {sport}")
    print(f"League ID: {league_id}")
    print("=" * 60)

    return fantrax_request(
        session,
        league_id,
        "getStandings",
        {
            "leagueId": league_id
        }
    )


# ---------------------------------------------------------
# FIND THE STANDINGS TABLE
# ---------------------------------------------------------

def find_standings_table(standings_data):

    tables = standings_data.get("tableList", [])

    for table in tables:
        if table.get("caption") == "Standings":
            return table

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
# CONVERT FANTRAX STANDINGS TO CLEAN JSON
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

        for index, cell in enumerate(stat_cells):

            if index < len(stat_keys):
                key = stat_keys[index]
            else:
                key = f"stat_{index}"

            team_data[key] = cell.get("content")

        standings.append(team_data)

    return standings


# ---------------------------------------------------------
# WRITE ONE SPORT'S STANDINGS TO JSON
# ---------------------------------------------------------

def league_settings(names, *, allow_missing_john=False):
    with open("web/data/league-settings.json", encoding="utf-8") as file:
        settings = json.load(file)
    expected = [owner["name"] for owner in settings["owners"]]
    points = settings["placement_points"]
    missing = set(expected) - set(names)
    unexpected = set(names) - set(expected)
    allowed_missing = {"John"} if allow_missing_john else set()
    if len(expected) < 2 or len(set(expected)) != len(expected) or len(set(names)) != len(names) or unexpected or missing - allowed_missing:
        raise ValueError(f"Fantrax owners do not match approved league membership. Missing: {sorted(set(expected)-set(names))}; unexpected: {sorted(set(names)-set(expected))}. Use the approved owner names in every Fantrax league.")
    if len(points) != len(expected) or any(type(p) not in (int, float) or not math.isfinite(p) or p < 0 for p in points) or any(b >= a for a, b in zip(points, points[1:])):
        raise ValueError("Invalid approved placement points")
    return settings


def save_league_json(
    sport,
    league_id,
    filename,
    standings_data
):
    from championship_calendar import championship_year
    canonical = 'EPL' if sport == 'Premier League' else sport
    connection = CONNECTIONS['sports'][canonical]
    # Never write an old pre-launch league into the first championship.
    if league_id == connection['current_league_id']:
        verified_year = championship_year(canonical, connection.get('current_season_year'))
    else:
        # Retained standings still require a verified sport convention.
        verified_year = championship_year(canonical, connection.get('standings_championship_year'))
    table = find_standings_table(standings_data)

    if table is None:
        raise RuntimeError(
            f"Could not find standings table for {sport}"
        )

    standings = parse_standings_table(table)
    settings = league_settings([row["team"] for row in standings], allow_missing_john=True)
    canonical = 'EPL' if sport == 'Premier League' else sport
    saved_year = CONNECTIONS['sports'][canonical].get('standings_championship_year', settings['championship_year'])
    if saved_year != verified_year:
        raise ValueError('Stored standings year disagrees with verified Fantrax mapping; review database state')
    if saved_year != settings['championship_year']:
        raise ValueError('Standings remain pinned to the previous championship. Archive and release them before updating the new championship.')
    missing_owners = sorted(set(owner["name"] for owner in settings["owners"]) - set(row["team"] for row in standings))
    if missing_owners:
        print(f"NOTICE: {sport}: no standings for {', '.join(missing_owners)}; displaying blank results.")
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
        "missing_owners": missing_owners,
        "teams": team_info,
        "placement_points": settings["placement_points"],
        "championship_year": settings["championship_year"],
        "calendar_mapping_verified": True,
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
# FETCH ONE FANTASY TEAM'S ROSTER
# ---------------------------------------------------------

def fetch_team_roster(
    session,
    league_id,
    team_id
):

    return fantrax_request(
        session,
        league_id,
        "getTeamRosterInfo",
        {
            "leagueId": league_id,
            "teamId": team_id,
            "view": "SIMPLE"
        }
    )


# ---------------------------------------------------------
# PARSE PLAYERS FROM ONE ROSTER
# ---------------------------------------------------------

def parse_roster(roster_data):

    players = []
    if not isinstance(roster_data, dict) or not isinstance(roster_data.get("tables"), list) or not roster_data["tables"]:
        raise ValueError("Missing roster tables; refusing to treat an unexpected response as an empty roster")

    # A Fantrax roster can contain multiple tables.
    # For example, NFL can separate offense and other
    # roster groups.
    for table in roster_data.get("tables", []):
        if not isinstance(table, dict) or not isinstance(table.get("rows"), list):
            raise ValueError("Missing roster rows")

        for row in table.get("rows", []):

            scorer = row.get("scorer")

            # Empty roster slots have no scorer object.
            if not scorer:
                continue

            player = {
                "player_id": scorer.get("scorerId"),
                "name": scorer.get("name"),
                "position": scorer.get("posShortNames"),
                "pro_team": scorer.get("teamShortName"),
                "pro_team_name": scorer.get("teamName"),
                "status_id": row.get("statusId"),
                "roster_position_id": row.get("posId"),
                "headshot_url": scorer.get("headshotUrl")
            }

            players.append(player)

    return players


# ---------------------------------------------------------
# FETCH ALL ROSTERS FOR ONE SPORT
# ---------------------------------------------------------

def fetch_all_rosters(
    session,
    sport,
    league_id,
    standings_data
):

    team_info = extract_team_info(
        standings_data
    )

    rosters = []

    print()
    print(f"Fetching {sport} rosters...")

    for team_id, team in team_info.items():

        owner = team.get("name")

        print(
            f"  Fetching roster: {owner}"
        )

        roster_data = fetch_team_roster(
            session,
            league_id,
            team_id
        )

        players = parse_roster(
            roster_data
        )

        roster = {
            "owner": owner,
            "team_id": team_id,
            "player_count": len(players),
            "players": players
        }

        rosters.append(roster)

        print(
            f"    {len(players)} player(s)"
        )

    return rosters


# ---------------------------------------------------------
# WRITE ROSTERS TO JSON
# ---------------------------------------------------------

def save_roster_json(
    sport,
    league_id,
    filename,
    rosters,
    fetch_started_at=None
):

    league_settings([row["owner"] for row in rosters])
    total_players = sum(
        roster["player_count"]
        for roster in rosters
    )

    output = {
        "sport": sport,
        "league_id": league_id,
        "fetch_started_at": fetch_started_at,
        "updated_at": datetime.now(
            timezone.utc
        ).isoformat(),
        "team_count": len(rosters),
        "total_players": total_players,
        "rosters": rosters
    }

    roster_directory = os.path.join(
        "web",
        "data",
        "rosters"
    )

    os.makedirs(
        roster_directory,
        exist_ok=True
    )

    filepath = os.path.join(
        roster_directory,
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

    print(
        f"SUCCESS: Created {filepath}"
    )

    print(
        f"Total rostered players in {sport}: "
        f"{total_players}"
    )


# ---------------------------------------------------------
# MAIN PROGRAM
# ---------------------------------------------------------

def main(argv=None):
    from championship_calendar import PrelaunchSeason
    parser = argparse.ArgumentParser(description="Update Fantrax saved data")
    parser.add_argument("--only", choices=("all", "standings", "rosters"), default="all")
    args = parser.parse_args(argv)

    print(
        "Starting Fantrax multi-sport update..."
    )

    session = create_session()

    print(
        "Fantrax cookies loaded."
    )

    successful = []
    failed = []
    skipped_standings = []

    for sport, config in LEAGUES.items():

        try:

            league_id = config["league_id"]
            filename = config["filename"]
            canonical = 'EPL' if sport == 'Premier League' else sport
            standings_league = CONNECTIONS['sports'][canonical].get('standings_league_id', league_id)

            # ---------------------------------------------
            # STANDINGS
            # ---------------------------------------------

            standings_data = fetch_league(
                session,
                sport,
                standings_league if args.only != 'rosters' else league_id
            )

            if args.only in ("all", "standings"):
                try:
                    save_league_json(sport, standings_league, filename, standings_data)
                except PrelaunchSeason:
                    skipped_standings.append(sport)
                    print(f"SKIPPED standings for {sport}: pre-launch season; no championship scores written.")

            if args.only in ("all", "rosters"):
                if args.only == 'all' and standings_league != league_id:
                    standings_data = fetch_league(session, sport, league_id)
                fetch_started_at = datetime.now(timezone.utc).isoformat()
                rosters = fetch_all_rosters(session, sport, league_id, standings_data)
                save_roster_json(sport, league_id, filename, rosters, fetch_started_at)

            if args.only != 'standings' or sport not in skipped_standings:
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
    print(f"Pre-launch standings skipped: {len(skipped_standings)}")
    for sport in skipped_standings:
        print(f"  - {sport} (saved standings unchanged; roster updates remain independent)")

    print(
        f"Successful: {len(successful)}"
    )

    for sport in successful:
        print(
            f"  ✓ {sport}"
        )

    print(
        f"Failed: {len(failed)}"
    )

    for failure in failed:
        print(
            f"  ✗ {failure['sport']}: "
            f"{failure['error']}"
        )

    if failed:
        raise RuntimeError(
            f"{len(failed)} league(s) failed to update."
        )

    print()
    print(
        f"Fantrax update ({args.only}) completed without errors; "
        f"{len(skipped_standings)} pre-launch standings skipped."
    )


if __name__ == "__main__":
    main()
