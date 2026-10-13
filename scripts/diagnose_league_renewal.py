"""Read-only renewal discovery. No website, database, or Fantrax mutations.

Endpoint evidence: https://github.com/pmurley/go-fantrax#retrieve-league-list
and #retrieve-league-info (Fantrax beta API bindings, April 2025 documentation).
Actual response schema and renewal linkage remain to be verified live.
"""
import json
import os
import re
import sys

OLD = "60ri2nbhmtj4b0km"
NEW = "rk8bvnk3mulovx9a"
BASE = "https://www.fantrax.com/fxea/general/"
SENSITIVE = re.compile(r"secret|password|token|cookie|email|user|authorization|url", re.I)
METADATA = re.compile(r"league|season|year|sport|renew|previous|next|parent", re.I)


def summarize(raw, secret):
    """Field paths are evidence, not a guessed response schema or renewal match."""
    fields, found = [], set()
    def walk(value, path="", depth=0):
        if depth > 20:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if SENSITIVE.search(str(key)) or secret in str(key):
                    continue
                walk(child, f"{path}.{key}" if path else str(key), depth + 1)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, f"{path}[{index}]", depth + 1)
        elif isinstance(value, (str, int, float, bool)) or value is None:
            if value in (OLD, NEW):
                found.add(value)
            if METADATA.search(path.rsplit(".", 1)[-1]) or value in (OLD, NEW):
                if isinstance(value, str):
                    value = value.replace(secret, "[REDACTED]")
                    if '@' in value or 'http' in value.lower():
                        value = '[omitted email or URL]'
                    value = value[:300]
                fields.append({"path": path, "value": value})
    walk(raw)
    return {"top_level_type": type(raw).__name__,
            "top_level_keys": [k for k in raw if not SENSITIVE.search(k) and secret not in k] if isinstance(raw, dict) else [],
            "known_ids_observed": sorted(found), "metadata_fields": fields[:300],
            "metadata_truncated": len(fields) > 300,
            "renewal_relationship_verified": False}


def inspect(session, secret):
    results = []
    # Only these three evidenced GET requests. Never follow redirects with a secret.
    for label, endpoint, params in [
        ('account_leagues', 'getLeagues', {'userSecretId': secret}),
        ('old_MLB', 'getLeagueInfo', {'leagueId': OLD}),
        ('new_MLB', 'getLeagueInfo', {'leagueId': NEW}),
    ]:
        print(f"Reading {label}", file=sys.stderr)
        try:
            response = session.get(BASE + endpoint, params=params, timeout=30, allow_redirects=False)
            if response.status_code != 200:
                results.append({'request': label, 'http_status': response.status_code, 'error': 'Request not successful; no redirect or fallback attempted.'})
                continue
            raw = response.json()
            results.append({'request': label, 'http_status': 200, **summarize(raw, secret)})
        except Exception:
            # requests exceptions can contain the credential-bearing URL.
            results.append({'request': label, 'error': 'Network or JSON failure; response not printed.'})
    return {'sport': 'MLB', 'old_league_id': OLD, 'new_league_id': NEW,
            'automatic_switch_performed': False,
            'scope': 'Metadata discovery only. HTTP 200 does not verify the response or a renewal relationship. Missing fields may require a browser Network capture.',
            'results': results}


def main():
    secret = os.environ.get('FANTRAX_USER_SECRET_ID', '').strip()
    if not secret:
        print('Set FANTRAX_USER_SECRET_ID privately in this terminal. No requests made.', file=sys.stderr)
        return 1
    import requests
    with requests.Session() as session:
        report = inspect(session, secret)
    print(json.dumps(report, indent=2))
    return int(any('error' in result for result in report['results']))


if __name__ == '__main__':
    sys.exit(main())
