"""Read-only MLB/NBA/EPL full-pool diagnostic and separate PGA filter check.

Default mode preserves the original single-page raw-response inspection.
"""
import argparse
import json
import os
import sys
from pathlib import Path
from nfl_player_pool import collect_pool

from diagnose_nfl_players import URL, build_payload, validate_envelope

# Matches scripts/fetch_fantrax.py; kept separate from production execution.
LEAGUES = {
    "MLB": "60ri2nbhmtj4b0km",
    "NBA": "u1byx3qkmtj47ogg",
    "EPL": "j08ymyupmtj415q3",
    "PGA": "xa7tza2hmthqz8bo",
}


FILTERS = {"MLB": "ALL", "NBA": "BASKETBALL_PLAYER", "EPL": "ALL"}
ROSTERS = {"MLB": "mlb", "NBA": "nba", "EPL": "premier-league"}


def inspect_page(session, sport, page=1, position_filter=None):
    payload = build_payload(page)
    if position_filter is not None:
        payload["msgs"][0]["data"]["positionOrGroup"] = position_filter
    response = session.post(
        URL, params={"leagueId": LEAGUES[sport]}, json=payload,
        timeout=30, allow_redirects=False,
    )
    if 300 <= response.status_code < 400:
        raise RuntimeError("Unexpected redirect")
    response.raise_for_status()
    raw = response.json()
    result = {"sport": sport, "league_id": LEAGUES[sport],
              "requested_page": page, "raw_response": raw, "validated": False}
    try:
        validate_envelope(raw)
    except ValueError:
        result["error"] = "Unexpected response envelope or API error; inspect raw_response."
        return result
    body = raw["responses"][0]["data"]
    result["inspection"] = {
        "availability_filter": body.get("displayedStatusOrTeam"),
        "position_filter": body.get("displayedPosOrGroup"),
        "position_options": body.get("posOrGroupList"),
        "pagination": body.get("paginatedResultSet"),
        "response_keys": list(body),
        "rows_on_page": len(body["statsTable"]) if isinstance(body.get("statsTable"), list) else None,
    }
    result["validated"] = body.get("displayedStatusOrTeam") == "ALL_AVAILABLE" and isinstance(body.get("statsTable"), list)
    if not result["validated"]:
        result["error"] = "Availability filter or player table differs from NFL; inspect raw_response."
    # Validated here only means the observed envelope/filter/table match;
    # it is never a completeness or cross-sport normalization claim.
    return result


def full_pool(session, sport, max_pages):
    if sport not in FILTERS:
        raise ValueError("PGA full pagination is not enabled; run --check-pga-filter first.")
    path = Path(__file__).resolve().parents[1] / "web/data/rosters" / (ROSTERS[sport] + ".json")
    roster = json.loads(path.read_text(encoding="utf-8-sig"))
    if roster.get("league_id") != LEAGUES[sport]:
        raise ValueError("Roster snapshot league mismatch.")
    ids = {p["player_id"] for r in roster["rosters"] for p in r["players"]}
    def fetch(page):
        print(f"Reading {sport} page {page}", file=sys.stderr)
        result = inspect_page(session, sport, page, FILTERS[sport])
        if not result["validated"]:
            raise ValueError(result["error"])
        return result["raw_response"]["responses"][0]["data"]
    result = collect_pool(fetch, LEAGUES[sport], ids, max_pages,
                          sport=sport, position_filter=FILTERS[sport])
    result["sport"] = sport
    result["summary"]["roster_snapshot_updated_at"] = roster.get("updated_at")
    result["summary"]["roster_check_scope"] = "Saved snapshot only; not a live roster verification"
    result["validated"] = result["summary"]["complete"]
    return result


def check_pga(session):
    # Compare current responses, not only the historical count of 3,880.
    results = [inspect_page(session, "PGA", 1, f) for f in ("POS_500", "GOLF_GOLFER")]
    return {"complete_pool": False, "purpose": "PGA filter comparison; manual review required",
            "requested_filters": ["POS_500", "GOLF_GOLFER"], "results": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", choices=[*LEAGUES, "all"], required=True)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--all-pages", action="store_true", help="Full MLB/NBA/EPL diagnostic; all excludes PGA")
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--check-pga-filter", action="store_true")
    args = parser.parse_args(argv)
    if args.max_pages < 1:
        parser.error("--max-pages must be positive")
    if args.check_pga_filter and (args.sport != "PGA" or args.all_pages or args.page != 1):
        parser.error("Use --sport PGA --check-pga-filter alone")
    if args.all_pages and (args.sport == "PGA" or args.page != 1):
        parser.error("--all-pages supports MLB/NBA/EPL/all and starts at page 1")
    try:
        build_payload(args.page)
    except ValueError as error:
        parser.error(str(error))
    cookie = os.environ.get("FANTRAX_COOKIE", "").strip()
    if not cookie:
        print("FANTRAX_COOKIE is missing; configure it privately.", file=sys.stderr)
        return 1
    try:
        import requests
    except ImportError:
        print("Install requests: python -m pip install requests", file=sys.stderr)
        return 1
    results = []
    with requests.Session() as session:
        for part in cookie.split(";"):
            if "=" in part:
                name, value = part.strip().split("=", 1)
                if name:
                    session.cookies.set(name, value, domain="www.fantrax.com", path="/")
        if args.check_pga_filter:
            try:
                report = check_pga(session)
                print(json.dumps(report, indent=2, ensure_ascii=True))
                return 0 if all(r["validated"] for r in report["results"]) else 1
            except (requests.RequestException, ValueError, RuntimeError) as error:
                print(f"PGA check failed ({type(error).__name__})", file=sys.stderr)
                return 1
        sports = (FILTERS if args.all_pages else LEAGUES) if args.sport == "all" else [args.sport]
        for sport in sports:
            print(f"Reading {sport} page {args.page}; coverage unverified.", file=sys.stderr)
            try:
                results.append(full_pool(session, sport, args.max_pages) if args.all_pages else inspect_page(session, sport, args.page))
            except (requests.RequestException, ValueError, RuntimeError, OSError, KeyError, TypeError) as error:
                reason = str(error) if type(error) is ValueError else type(error).__name__
                results.append({"sport": sport, "validated": False,
                                "error": f"Diagnostic failed: {reason}"})
    print(json.dumps({"complete_pool": args.all_pages and all(r["validated"] for r in results), "results": results}, indent=2, ensure_ascii=True))
    return 0 if all(r["validated"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
