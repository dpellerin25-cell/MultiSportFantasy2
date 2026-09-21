"""One read-only NFL player-list request; raw JSON on stdout, no data files.

Evidence: user's getPlayerStats capture and go-fantrax v0.1.19:
https://pkg.go.dev/github.com/pmurley/go-fantrax/auth_client#GetPlayerPoolRequest
https://pkg.go.dev/github.com/pmurley/go-fantrax/auth_client#StatusFilterAvailable
This is a diagnostic, not a complete player-pool importer.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from nfl_player_pool import collect_pool

NFL_LEAGUE_ID = "yg0olhfrmtj45dd6"
URL = "https://www.fantrax.com/fxpa/req"


def build_payload(page=1):
    if type(page) is not int or page < 1:
        raise ValueError("Page must be a positive integer.")
    return {"msgs": [{"method": "getPlayerStats", "data": {
        "statusOrTeamFilter": "ALL_AVAILABLE",
        "pageNumber": str(page),
    }}]}


def fetch_page(session, page=1):
    # No retries, auto-pagination, arbitrary methods, or redirect following.
    response = session.post(
        URL, params={"leagueId": NFL_LEAGUE_ID},
        json=build_payload(page), timeout=30, allow_redirects=False,
    )
    if 300 <= response.status_code < 400:
        raise RuntimeError("Unexpected redirect; check the Fantrax session.")
    response.raise_for_status()
    return response.json()


def validate_envelope(data):
    if not isinstance(data, dict) or data.get("error"):
        raise ValueError("Fantrax returned an error or an unexpected envelope.")
    responses = data.get("responses")
    if not isinstance(responses, list) or len(responses) != 1:
        raise ValueError("Expected one Fantrax response; inspect raw output.")
    item = responses[0]
    if not isinstance(item, dict) or item.get("error"):
        raise ValueError("Fantrax returned a message error; inspect raw output.")
    body = item.get("data")
    if not isinstance(body, dict) or body.get("error"):
        raise ValueError("Missing player data or API error; inspect raw output.")
    # Do not interpret availability or claim completeness from this envelope.


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--all-pages", action="store_true", help="Validate and summarize the complete NFL pool")
    parser.add_argument("--max-pages", type=int, default=500)
    args = parser.parse_args(argv)
    try:
        build_payload(args.page)
    except ValueError as error:
        parser.error(str(error))
    cookie = os.environ.get("FANTRAX_COOKIE", "").strip()
    if not cookie:
        print("FANTRAX_COOKIE is missing. Set it privately in this shell.", file=sys.stderr)
        return 1
    try:
        import requests
    except ImportError:
        print("Missing requests dependency. Run: python -m pip install requests", file=sys.stderr)
        return 1
    with requests.Session() as session:
        for part in cookie.split(";"):
            if "=" in part:
                name, value = part.strip().split("=", 1)
                if name:
                    session.cookies.set(name, value, domain="www.fantrax.com", path="/")
        if args.all_pages:
            try:
                roster_path = Path(__file__).resolve().parents[1] / "web/data/rosters/nfl.json"
                roster = json.loads(roster_path.read_text(encoding="utf-8-sig"))
                if roster.get("league_id") != NFL_LEAGUE_ID:
                    raise ValueError("NFL roster snapshot league mismatch.")
                ids = {p["player_id"] for r in roster["rosters"] for p in r["players"]}
                def fetch_body(page):
                    print(f"Reading NFL page {page}", file=sys.stderr)
                    raw = fetch_page(session, page)
                    validate_envelope(raw)
                    return raw["responses"][0]["data"]
                result = collect_pool(fetch_body, NFL_LEAGUE_ID, ids, args.max_pages)
                result["summary"]["roster_snapshot_updated_at"] = roster.get("updated_at")
                result["summary"]["roster_check_scope"] = "Saved snapshot only; not a live roster verification"
                print(json.dumps(result, indent=2, ensure_ascii=True))
                if not result["summary"]["complete"]:
                    print("Unique count does not match total; incomplete pool. Rerun.", file=sys.stderr)
                    return 1
                return 0
            except (ValueError, KeyError, TypeError, OSError, RuntimeError, requests.RequestException) as error:
                message = str(error) if isinstance(error, ValueError) else type(error).__name__
                print(f"Full-pool diagnostic failed: {message}", file=sys.stderr)
                return 1
        print(f"NFL getPlayerStats page {args.page}; ALL_AVAILABLE includes waivers. "
              "Single-page diagnostic; position coverage and completeness unverified.", file=sys.stderr)
        try:
            data = fetch_page(session, args.page)
        except (requests.RequestException, ValueError, RuntimeError) as error:
            # Do not print request objects/headers or cookie-bearing exceptions.
            print(f"Read failed ({type(error).__name__}); check session/network.", file=sys.stderr)
            return 1
        print(json.dumps(data, indent=2, ensure_ascii=True))
        try:
            validate_envelope(data)
        except ValueError as error:
            print(str(error), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

    raise SystemExit(main())
