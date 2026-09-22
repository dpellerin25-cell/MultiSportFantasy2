"""Export all five validated available-player pools, outside production data."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import tempfile

from diagnose_nfl_players import NFL_LEAGUE_ID, fetch_page, validate_envelope
from diagnose_sport_players import LEAGUES, FILTERS, REQUEST_FILTERS, ROSTERS, inspect_page
from nfl_player_pool import collect_pool

ROOT = Path(__file__).resolve().parents[1]


def now():
    return datetime.now(timezone.utc).isoformat()


def export_data(session, max_pages=1000):
    started = now()
    players, summaries = [], {}
    for sport, league in {"NFL": NFL_LEAGUE_ID, **LEAGUES}.items():
        begin = now()
        roster = json.loads((ROOT / "web/data/rosters" / ("nfl.json" if sport == "NFL" else ROSTERS[sport]+".json")).read_text(encoding="utf-8-sig"))
        if roster.get("league_id") != league:
            raise ValueError(f"{sport}: roster snapshot league mismatch")
        ids = {p["player_id"] for r in roster["rosters"] for p in r["players"]}
        def fetch(page):
            print(f"Reading {sport} page {page}", file=sys.stderr)
            if sport == "NFL":
                raw = fetch_page(session, page)
                validate_envelope(raw)
            else:
                response = inspect_page(session, sport, page, REQUEST_FILTERS[sport])
                if not response["validated"]:
                    raise ValueError(f"{sport}: unexpected response")
                raw = response["raw_response"]
            return raw["responses"][0]["data"]
        result = collect_pool(fetch, league, ids, max_pages, sport=sport,
                              position_filter="FOOTBALL_OFFENSE" if sport == "NFL" else FILTERS[sport],
                              include_players=True)
        if not result["summary"]["complete"]:
            raise ValueError(f"{sport}: incomplete unique-player count; no export written")
        summary = result["summary"]
        summary.update(league_id=league, started_at=begin, completed_at=now(),
                       availability_filter="ALL_AVAILABLE",
                       requested_position_filter=None if sport == "NFL" else REQUEST_FILTERS[sport],
                       effective_position_filter="FOOTBALL_OFFENSE" if sport == "NFL" else FILTERS[sport],
                       roster_snapshot_updated_at=roster.get("updated_at"))
        summaries[sport] = summary
        players.extend(result["players"])
    keys = {(p["league_id"], p["player_id"]) for p in players}
    if len(keys) != len(players):
        raise ValueError("Duplicate league/player identity in combined export")
    return {"schema_version": 1, "source": "Fantrax getPlayerStats",
            "started_at": started, "completed_at": now(), "complete": True,
            "roster_check_scope": "Saved snapshots only; not live roster verification",
            "snapshot_scope": "Sequential league reads, not an atomic snapshot",
            "total_players": len(players), "sports": summaries,
            "players": sorted(players, key=lambda p: (p["sport"], p["player_id"]))}


def write_export(path, data):
    path = Path(path).resolve()
    if path.is_relative_to((ROOT / "web").resolve()) or path.is_relative_to((ROOT / ".git").resolve()):
        raise ValueError("Export must be outside web/ and .git/")
    if path.exists():
        raise ValueError("Output already exists; choose a new filename")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as file:
            temporary = Path(file.name)
            json.dump(data, file, indent=2, ensure_ascii=True)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
        # Publish a complete file without overwriting an existing export.
        os.link(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, default=1000)
    args = parser.parse_args(argv)
    if args.max_pages < 1:
        parser.error("--max-pages must be positive")
    target = args.output.resolve()
    if target.exists() or target.is_relative_to((ROOT / "web").resolve()) or target.is_relative_to((ROOT / ".git").resolve()):
        parser.error("Choose a new output file outside web/ and .git/")
    cookie = os.environ.get("FANTRAX_COOKIE", "").strip()
    if not cookie:
        print("FANTRAX_COOKIE is missing; configure it privately.", file=sys.stderr)
        return 1
    try:
        import requests
    except ImportError:
        print("Install requests: python -m pip install requests", file=sys.stderr)
        return 1
    try:
        with requests.Session() as session:
            for part in cookie.split(";"):
                if "=" in part:
                    name, value = part.strip().split("=", 1)
                    if name:
                        session.cookies.set(name, value, domain="www.fantrax.com", path="/")
            data = export_data(session, args.max_pages)
        write_export(target, data)
    except (requests.RequestException, ValueError, RuntimeError, OSError, KeyError, TypeError) as error:
        reason = str(error) if type(error) is ValueError else type(error).__name__
        print(f"Export failed: {reason}", file=sys.stderr)
        return 1
    print(json.dumps({"output": str(target), "total_players": data["total_players"],
                      "sports": data["sports"], "sample": data["players"][:5]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
