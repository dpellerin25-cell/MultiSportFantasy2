"""Read-only league discovery using the user's verified getLeagues/getLeagueInfo schemas.
No production imports, database calls, switching or deletion. Config is preview-only.
"""
import json
import os
from pathlib import Path
import re
import sys

BASE = 'https://www.fantrax.com/fxea/general/'
CONFIG = Path(__file__).with_name('fantrax-renewal-preview.json')
ID = re.compile(r'^[a-z0-9]{16}$')


def metadata(raw):
    if not isinstance(raw, dict) or any(k in raw for k in ('error', 'errors', 'pageError')):
        raise ValueError('Invalid league metadata')
    history, year = raw.get('leagueHistoryId'), raw.get('seasonYear')
    if not isinstance(history, str) or not ID.fullmatch(history) or type(year) is not int or not 2000 <= year <= 2200:
        raise ValueError('Missing history or season')
    return {'league_history_id': history, 'season_year': year}


def discover(get, config):
    excluded = set(config['excluded_league_ids'])
    if any(not ID.fullmatch(x) for x in excluded):
        raise ValueError('Invalid exclusion')
    raw = get('getLeagues', None)
    if not isinstance(raw, dict) or not isinstance(raw.get('leagues'), list) or any(k in raw for k in ('error', 'errors', 'pageError')):
        raise ValueError('Invalid league list')
    # Bounded discovery: never accept a truncated search as an unambiguous match.
    if len(raw['leagues']) > 100:
        raise ValueError('League discovery exceeds diagnostic limit')
    leagues = {}
    for row in raw['leagues']:
        if not isinstance(row, dict):
            raise ValueError('Invalid league entry')
        lid = row.get('leagueId')
        if lid in excluded:
            continue
        if not isinstance(lid, str) or not ID.fullmatch(lid) or not isinstance(row.get('sport'), str) or lid in leagues:
            raise ValueError('Invalid or duplicate league identity')
        leagues[lid] = row['sport']
    cache = {}
    def info(lid):
        if lid not in cache:
            try:
                cache[lid] = metadata(get('getLeagueInfo', lid))
            except Exception:
                cache[lid] = None
        return cache[lid]
    results = []
    for sport, setting in config['sports'].items():
        current, target = setting['current_league_id'], setting['target_season_year']
        result = {'sport': sport, 'current_league_id': current, 'target_season_year': target,
                  'proposed_league_id': None, 'status': 'blocked', 'candidates': []}
        results.append(result)
        if current in excluded or leagues.get(current) != sport:
            result['reason'] = 'Current league absent from account list or sport mismatch'
            continue
        baseline = info(current)
        if not baseline or (setting.get('league_history_id') and setting['league_history_id'] != baseline['league_history_id']):
            result['reason'] = 'Current league metadata unavailable or pinned history changed'
            continue
        result['current_metadata'] = baseline
        failed = []
        for lid, candidate_sport in leagues.items():
            if candidate_sport != sport:
                continue
            candidate = info(lid)
            if candidate is None:
                failed.append(lid)
            elif candidate['league_history_id'] == baseline['league_history_id']:
                result['candidates'].append({'league_id': lid, **candidate})
        if failed:
            result['reason'] = 'Candidate metadata incomplete; cannot safely rule out another match'
            result['unreadable_league_ids'] = failed
        elif type(target) is not int or not 2000 <= target <= 2200:
            result['reason'] = 'Confirm Fantrax seasonYear for this sport before proposing a connection'
        else:
            matches = [c for c in result['candidates'] if c['season_year'] == target]
            if len(matches) != 1:
                result['reason'] = 'No matching target season' if not matches else 'Multiple matching target-season leagues'
            else:
                result['proposed_league_id'] = matches[0]['league_id']
                result['status'] = 'unchanged' if matches[0]['league_id'] == current else 'awaiting_commissioner_approval'
                result['reason'] = 'Exact sport, history and target-season match; no connection changed'
    return {'preview_only': True, 'automatic_switch_performed': False,
            'excluded_league_ids': sorted(excluded), 'results': results}


def main():
    secret = os.environ.get('FANTRAX_USER_SECRET_ID', '').strip()
    if not secret:
        print('Set FANTRAX_USER_SECRET_ID privately. No requests made.', file=sys.stderr)
        return 1
    try:
        import requests
        config = json.loads(CONFIG.read_text(encoding='utf-8-sig'))
        with requests.Session() as session:
            def get(endpoint, lid):
                params = {'userSecretId': secret} if endpoint == 'getLeagues' else {'leagueId': lid}
                response = session.get(BASE + endpoint, params=params, timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('Read failed')
                return response.json()
            report = discover(get, config)
        # Output only validated IDs, integer seasons, fixed messages. No names,
        # private team data, response text, request URLs or credentials.
        print(json.dumps(report, indent=2).replace(secret, '[REDACTED]'))
        return 0
    except Exception:
        print('Discovery failed: check credentials and response schema. No connections changed; request details omitted to protect credentials.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
