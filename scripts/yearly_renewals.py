"""Discover renewals or capture only NEW-season pools. No activation or database writes."""
import argparse
import copy
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from fantrax_connections import CONNECTIONS
from preview_fantrax_connections import discover, metadata, BASE
from fetch_fantrax import create_session
from validate_mlb_renewal import read_rosters
from diagnose_nfl_players import URL, build_payload, validate_envelope
from diagnose_sport_players import FILTERS, REQUEST_FILTERS
from nfl_player_pool import collect_pool

ROOT = Path(__file__).resolve().parents[1]


def safe_failure(error):
    # Never print arbitrary exception text: requests may include secret URLs.
    messages = {
        'Authentication rejected': 'Fantrax rejected the session. Copy a fresh Cookie header from a logged-in league request.',
        'API response failed': 'Fantrax returned an API error; authentication or league access may need attention.',
        'League response failed': 'Fantrax returned a non-200 league response.',
        'Metadata response failed': 'Fantrax returned a non-200 metadata response.',
        'Renewal metadata mismatch': 'The old/new league history or season no longer matches.',
        'Complete approved membership required': 'The renewed league does not contain exactly the approved owners.',
        'Missing or unexpected team list': 'The standings response has no usable team list.',
        'Invalid or duplicate owner names': 'The roster owner names are invalid or duplicated.',
        'Roster changed during capture': 'Rosters changed during the capture; retry with fresh evidence.',
        'Metadata changed during capture': 'League metadata changed during the capture.',
        'Incomplete pool': 'The player pool is incomplete or contains unknown availability.',
    }
    return messages.get(str(error), 'Unrecognized response or local failure; raw details withheld to protect credentials.')


def check_api_error(raw):
    if not isinstance(raw, dict):
        raise ValueError('API response failed')
    responses = raw.get('responses', [])
    if not isinstance(responses, list):
        raise ValueError('API response failed')
    errors = [item['pageError'] for item in [raw, *responses]
              if isinstance(item, dict) and 'pageError' in item]
    if any(isinstance(e, dict) and e.get('code') == 'WARNING_NOT_LOGGED_IN' for e in errors):
        raise ValueError('Authentication rejected')
    if errors:
        raise ValueError('API response failed')

def capture(get, request, sport, candidate, settings, progress):
    old, new = candidate['current_league_id'], candidate['proposed_league_id']
    start = datetime.now(timezone.utc).isoformat()
    progress(f'Checking {sport} renewal metadata')
    baseline, target = metadata(get('getLeagueInfo', old)), metadata(get('getLeagueInfo', new))
    if not baseline['league_history_id'] or target['league_history_id'] != baseline['league_history_id'] or target['season_year'] != candidate['target_season_year'] or target['season_year'] != baseline['season_year']+1:
        raise ValueError('Renewal metadata mismatch')
    names = {o['name']: o['slug'] for o in settings['owners']}
    progress(f'Checking {sport} initial standings and rosters')
    before = read_rosters(request, new, list(names))
    if before['membership']['missing_owners'] or before['membership']['unexpected_owner_count']:
        # Only approved local names are printed; never echo unknown response text.
        progress('Membership check: ' + json.dumps({
            'approved_owners': sorted(names),
            'matched_owners': sorted(before['teams'].values()),
            'missing_owners': before['membership']['missing_owners'],
            'unexpected_owner_count': before['membership']['unexpected_owner_count'],
        }))
        raise ValueError('Complete approved membership required')
    def page(number):
        progress(f'Reading {sport} new-season page {number}')
        data = build_payload(number)['msgs'][0]['data']
        data['positionOrGroup'] = REQUEST_FILTERS.get(sport, 'FOOTBALL_OFFENSE')
        return request(new, 'getPlayerStats', data)
    pool = collect_pool(page, new, set(before['players']), 1000, sport=sport,
                        position_filter=FILTERS.get(sport, 'FOOTBALL_OFFENSE'), include_players=True)
    if not pool['summary']['complete'] or pool['summary']['unknown_status_count']:
        raise ValueError('Incomplete pool')
    progress(f'Rechecking {sport} rosters after player capture')
    if before != read_rosters(request, new, list(names)):
        raise ValueError('Roster changed during capture')
    if metadata(get('getLeagueInfo', old)) != baseline or metadata(get('getLeagueInfo', new)) != target:
        raise ValueError('Metadata changed during capture')
    players = {p['player_id']: p['player_name'] for p in pool['players']}
    players.update({pid: p['player_name'] for pid, p in before['players'].items()})
    rosters = [{'owner': names[name], 'players': [{'player_id': pid, 'name': p['player_name']}
                for pid, p in before['players'].items() if p['owner'] == tid]}
               for tid, name in before['teams'].items()]
    return {'schema_version': 1, 'sport': sport, 'old_league_id': old, 'new_league_id': new,
            'standings_league_id': CONNECTIONS['sports'][sport].get('standings_league_id', old),
            'standings_championship_year': CONNECTIONS['sports'][sport].get('standings_championship_year', CONNECTIONS['championship_year']),
            'history_id': target['league_history_id'], 'season_year': target['season_year'],
            'old_season_year': baseline['season_year'], 'started_at': start,
            'completed_at': datetime.now(timezone.utc).isoformat(), 'pool_summary': pool['summary'],
            'players': [{'player_id': pid, 'player_name': name} for pid, name in sorted(players.items())],
            'rosters': rosters, 'capture_checks_passed': True}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--capture', choices=['NFL','MLB','NBA','EPL','PGA','automatic'])
    parser.add_argument('--refresh', action='store_true', help='Ignore a reusable capture and fetch again')
    args = parser.parse_args()
    stage = 'checking inputs'
    try:
        out = Path(args.directory).resolve()
        if out.is_relative_to(ROOT):
            raise ValueError('Use directory outside repository')
        out.mkdir(parents=True, exist_ok=True)
        if not os.environ.get('FANTRAX_USER_SECRET_ID') or (args.capture and not os.environ.get('FANTRAX_COOKIE')):
            raise ValueError('Credentials missing')
        secret = os.environ['FANTRAX_USER_SECRET_ID'].strip()
        import requests
        session = create_session() if args.capture else requests.Session()
        with session:
            def get(endpoint, lid):
                response = session.get(BASE+endpoint, params={'userSecretId': secret} if lid is None else {'leagueId': lid}, timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('Metadata response failed')
                return response.json()
            def request(lid, method, data):
                response = session.post(URL, params={'leagueId': lid}, json={'msgs':[{'method':method,'data':data}]}, timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('League response failed')
                raw = response.json()
                check_api_error(raw)
                validate_envelope(raw)
                return raw['responses'][0]['data']
            config = copy.deepcopy(CONNECTIONS)
            for value in config['sports'].values():
                value['target_season_year'] = max(value['target_season_year'], value.get('current_season_year',2026)+1)
            stage = 'discovering next-season leagues'
            report = discover(get, config)
            policy = json.loads((ROOT/'scripts/fantrax-renewal-policy.json').read_text())
            settings = json.loads((ROOT/'web/data/league-settings.json').read_text(encoding='utf-8-sig'))
            for row in report['results']:
                sport = row['sport']
                if row['status'] != 'awaiting_commissioner_approval':
                    continue
                p = policy['sports'][sport]
                if args.capture == 'automatic':
                    if p['mode'] != 'automatic' or not p['automatic_month_day']:
                        continue
                    due = datetime.fromisoformat(f"{row['target_season_year']}-{p['automatic_month_day']}T00:00:00+00:00")
                    if datetime.now(timezone.utc) < due:
                        continue
                elif args.capture != sport:
                    continue
                stage = f'capturing {sport}'
                path = out/f'{sport}-capture.json'
                # Reuse valid recent candidate captures; never refetch the old pool.
                if path.exists() and not args.refresh:
                    cached = json.loads(path.read_text())
                    age = (datetime.now(timezone.utc)-datetime.fromisoformat(cached['started_at'])).total_seconds()
                    if cached.get('new_league_id') == row['proposed_league_id'] and cached.get('old_league_id') == row['current_league_id'] and cached.get('capture_checks_passed') and 0 <= age < 21600:
                        row['capture_reused'] = True
                        continue
                def progress(msg):
                    nonlocal stage
                    stage = msg
                    print(msg, file=sys.stderr)
                evidence = capture(get, request, sport, row, settings, progress)
                path.write_text(json.dumps(evidence, indent=2), encoding='utf-8')
                row['capture_saved'] = True
            safe = json.dumps(report,indent=2).replace(secret,'[REDACTED]')
            (out/'discovery.json').write_text(safe,encoding='utf-8')
            print(safe)
        return 0
    except Exception as error:
        print(f'Renewal discovery/capture failed while {stage}. {safe_failure(error)} No activation performed.',file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
