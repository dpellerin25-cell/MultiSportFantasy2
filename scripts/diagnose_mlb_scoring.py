"""Read-only replay of Doug's captured MLB scoring request for 2026-09-24."""
import argparse
import json
import math
import os
from pathlib import Path
import sys

LEAGUE = '60ri2nbhmtj4b0km'
TEAM = 'ef2fvskgmtj4b1bq'
DATE = '2026-09-24'


def build_payload():
    return {'msgs': [{'method': 'getLiveScoringStats', 'data': {
        'sppId': '-1', 'mobileMatchupView': False, 'teamId': TEAM,
        'layout': 'STANDARD', 'mainView': 'MATCHUP', 'mobileView': 'MATCHUPS',
        'mode': 'fpts', 'date': DATE, 'playerViewType': '2', 'newView': True}},
        {'method': 'getScoresSummaryData', 'data': {}}],
        'uiv': 3, 'refUrl': f'https://www.fantrax.com/fantasy/league/{LEAGUE}/livescoring;date=2026-09-23;playerViewType=2?mobileMatchupView=false&teamId={TEAM}&layout=STANDARD&mainView=MATCHUP&mobileView=MATCHUPS&mode=fpts',
        'dt': 1, 'at': 0, 'tz': 'America/New_York', 'v': '187.3.5'}


def points(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Missing or invalid fantasy points')
    return value


def normalize(raw):
    if not isinstance(raw, dict) or raw.get('error') or raw.get('pageError'):
        raise ValueError('API error or invalid response')
    responses = raw.get('responses')
    if not isinstance(responses, list) or len(responses) != 2:
        raise ValueError('Expected the captured two-message response')
    for response in responses:
        if not isinstance(response, dict) or response.get('error') or response.get('pageError'):
            raise ValueError('Message error')
    data = responses[0]['data']
    if data.get('error') or data.get('pageError'):
        raise ValueError('Scoring response error')
    selected = data['displayedSelections']
    if data.get('date') != DATE or selected.get('date') != DATE or selected.get('teamId') != TEAM:
        raise ValueError('Returned date/team differs from request')
    if selected.get('viewType', {}).get('name') != 'Day' or selected.get('playerViewType', {}).get('id') != '2':
        raise ValueError('Unexpected scoring view')
    if data.get('allEventsFinished') is not True:
        raise ValueError('Events are not finished')
    if data['fantasyTeamInfo'][TEAM]['name'] != 'Doug':
        raise ValueError('Team identity changed')
    players, totals, seen = [], {}, set()
    groups = data['statsPerTeam']['allTeamsStats'][TEAM]
    if set(groups) != {'ACTIVE', 'BENCH'}:
        raise ValueError('Unexpected lineup group')
    for group in ('ACTIVE', 'BENCH'):
        stats = groups[group]['statsMap']
        names = {}
        for rows in data['scorerMap'][group][TEAM].values():
            for row in rows:
                scorer = row['scorer']; pid = scorer['scorerId']
                if pid in seen or pid in names:
                    raise ValueError('Duplicate player identity')
                names[pid] = scorer
        seen.update(names)
        actual = {pid: value for pid, value in stats.items() if not pid.startswith('_')}
        if not set(actual).issubset(names):
            raise ValueError('Scoring record lacks player identity')
        total = sum(points(value['object1']) for value in actual.values())
        totals[group] = points(groups[group]['totalFpts'])
        if not math.isclose(total, totals[group], abs_tol=1e-8, rel_tol=0):
            raise ValueError('Player points do not reconcile with lineup total')
        for pid, scorer in names.items():
            value = points(actual[pid]['object1']) if pid in actual else None
            players.append({'player_id': pid, 'player_name': scorer['name'],
                'sport': 'MLB', 'league_id': LEAGUE, 'team_id': TEAM, 'owner': 'Doug',
                'scoring_date': DATE, 'lineup_group': group,
                'fantasy_points': value,
                'team_contribution': value if group == 'ACTIVE' else 0,
                'stat_record_present': pid in actual})
    return {'read_only': True, 'league_id': LEAGUE, 'team_id': TEAM, 'date': DATE,
        'all_events_finished': True, 'active_total': totals['ACTIVE'], 'bench_total': totals['BENCH'],
        'totals_reconcile': True, 'players': players,
        'scope': 'Captured All Players Playing view; not a roster count or proof of finalized historical Best Ball eligibility. Missing player stat rows remain unknown, not invented zeros.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--response', type=Path, help='Inspect saved response without network access')
    mode.add_argument('--live', action='store_true', help='Replay the captured read-only request using FANTRAX_COOKIE')
    args = parser.parse_args()
    try:
        if args.response:
            raw = json.loads(args.response.read_text(encoding='utf-8-sig'))
        else:
            cookie = os.environ.get('FANTRAX_COOKIE', '').strip()
            if not cookie:
                raise ValueError('FANTRAX_COOKIE is missing; set it privately in this terminal')
            import requests
            with requests.Session() as session:
                for part in cookie.split(';'):
                    if '=' in part:
                        key, value = part.strip().split('=', 1)
                        session.cookies.set(key.strip(), value.strip())
                response = session.post('https://www.fantrax.com/fxpa/req',
                    params={'leagueId': LEAGUE}, json=build_payload(), timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('Scoring request unsuccessful')
                raw = response.json()
        result = normalize(raw)
        result['source'] = 'live' if args.live else 'saved_response'
        print(json.dumps(result, indent=2))
        return 0
    except Exception:
        print('MLB scoring diagnostic failed. Check FANTRAX_COOKIE, response date/team and complete scoring data. No changes made; raw errors withheld to protect credentials.', file=sys.stderr)
        return 1


if __name__ == '__main__': sys.exit(main())
