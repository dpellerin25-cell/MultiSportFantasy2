"""One approved scoring job over stdin. Read-only Fantrax access; no secrets printed."""
import json
import os
import re
import sys
from datetime import datetime, timezone
from diagnose_scoring import build_payload, normalize


def collect(target, session):
    if target.get('sport') not in ('NFL', 'MLB', 'NBA', 'EPL', 'PGA'):
        raise ValueError('Invalid sport')
    for key in ('league_id', 'team_id'):
        if not re.fullmatch(r'[a-z0-9]{16}', target.get(key, '')):
            raise ValueError('Invalid identity')
    response = session.post('https://www.fantrax.com/fxpa/req',
                            params={'leagueId': target['league_id']},
                            json=build_payload(target), timeout=45, allow_redirects=False)
    if response.status_code != 200:
        raise ValueError('HTTP failure')
    diagnostic = normalize(response.json(), target)
    return {'observed_at': datetime.now(timezone.utc).isoformat(), 'diagnostic': diagnostic}


def main():
    try:
        import requests
        cookie = os.environ.get('FANTRAX_COOKIE', '').strip()
        if not cookie:
            raise ValueError('Missing authentication')
        target = json.load(sys.stdin)
        with requests.Session() as session:
            for part in cookie.split(';'):
                if '=' in part:
                    key, value = part.strip().split('=', 1)
                    session.cookies.set(key.strip(), value.strip())
            print(json.dumps(collect(target, session), allow_nan=False))
        return 0
    except Exception:
        # Never print response bodies or exception strings that may contain secrets.
        print('INCOMPLETE_RESPONSE', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
