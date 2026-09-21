"""Inspect one player-list page per selected sport; no full-pool assumptions.

Uses the NFL-verified read request. Other sports' response formats and effective
position filters must be inspected before extending the full-pool importer.
"""
import argparse
import json
import os
import sys

from diagnose_nfl_players import URL, build_payload, validate_envelope

# Matches scripts/fetch_fantrax.py; kept separate from production execution.
LEAGUES = {
    "MLB": "60ri2nbhmtj4b0km",
    "NBA": "u1byx3qkmtj47ogg",
    "EPL": "j08ymyupmtj415q3",
    "PGA": "xa7tza2hmthqz8bo",
}


def inspect_page(session, sport, page=1):
    response = session.post(
        URL, params={"leagueId": LEAGUES[sport]}, json=build_payload(page),
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


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", choices=[*LEAGUES, "all"], required=True)
    parser.add_argument("--page", type=int, default=1)
    args = parser.parse_args(argv)
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
        for sport in LEAGUES if args.sport == "all" else [args.sport]:
            print(f"Reading {sport} page {args.page}; coverage unverified.", file=sys.stderr)
            try:
                results.append(inspect_page(session, sport, args.page))
            except (requests.RequestException, ValueError, RuntimeError) as error:
                results.append({"sport": sport, "validated": False,
                                "error": f"Request failed ({type(error).__name__}); check session/network."})
    print(json.dumps({"complete_pool": False, "results": results}, indent=2, ensure_ascii=True))
    return 0 if all(r["validated"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
