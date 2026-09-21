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
