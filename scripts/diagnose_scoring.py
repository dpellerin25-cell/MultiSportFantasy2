"""Read-only five-sport scoring diagnostic. Historical examples only; no production writes."""
import argparse
from datetime import date as calendar_date
from datetime import datetime, timezone
import re
from urllib.parse import urlencode
import json
import math
import os
from pathlib import Path
import sys

PROFILES = {
    'MLB': ('60ri2nbhmtj4b0km', 'ef2fvskgmtj4b1bq', 'Doug', '2026-09-24'),
    'NFL': ('yg0olhfrmtj45dd6', 'rjrxjrgomtufxavs', 'Ryan', '2026-10-25'),
    'NBA': ('u1byx3qkmtj47ogg', 'dghm6tvbmtug00lx', 'Hatch', '2026-10-23'),
    'EPL': ('j08ymyupmtj415q3', 'y00vzeaumtj4175c', 'Doug', '2026-10-25'),
    'PGA': ('xa7tza2hmthqz8bo', '427i3hphmtj6q46k', 'Brendan', 21),
}


def target(sport, date=None, period=None, team=None, owner=None):
    league, default_team, default_owner, default_when = PROFILES[sport]
    if bool(team) != bool(owner):
        raise ValueError('Supply team ID and exact owner name together')
    team, owner = team or default_team, owner or default_owner
    if not re.fullmatch(r'[a-zA-Z0-9]+', team) or not owner.strip():
        raise ValueError('Invalid team ID or owner name')
    if sport == 'PGA':
        if date is not None: raise ValueError('PGA requires a tournament period, not a date')
        period = default_when if period is None else period
        if type(period) is not int or period < 1: raise ValueError('Invalid tournament period')
    else:
        if period is not None: raise ValueError('Daily sports require a date, not a period')
        date = date or default_when
        try:
            valid = calendar_date.fromisoformat(date).isoformat() == date
        except ValueError:
            valid = False
        if not valid: raise ValueError('Use a valid YYYY-MM-DD date')
    return {'sport':sport, 'league_id':league, 'team_id':team, 'owner':owner,
            'scoring_date':date, 'tournament_period':period}


def build_payload(t):
    sport, team = t['sport'], t['team_id']
    data = {'sppId':'-1','mobileMatchupView':sport != 'MLB','teamId':team,
            'layout':'STANDARD','mainView':'MATCHUP','mobileView':'MATCHUPS',
            'mode':'fpts','newView':True}
    if sport != 'EPL': data['playerViewType'] = '2'
    if sport in ('NFL','EPL'): data['viewType'] = '1'
    if sport == 'EPL': data['reload'] = '1'
    key, when = ('period',str(t['tournament_period'])) if sport == 'PGA' else ('date',t['scoring_date'])
    data[key] = when
    query = urlencode({'teamId':team,'layout':'STANDARD','mainView':'MATCHUP',
                       'mobileView':'MATCHUPS','mobileMatchupView':str(data['mobileMatchupView']).lower(),'mode':'fpts'})
    return {'msgs':[{'method':'getLiveScoringStats','data':data},
                    {'method':'getScoresSummaryData','data':{}}],
            'uiv':3,'dt':1,'at':0,'tz':'America/New_York',
            'v': '187.3.5' if sport == 'MLB' else '187.4.0' if sport == 'NFL' else '187.4.1',
            'refUrl':f"https://www.fantrax.com/fantasy/league/{t['league_id']}/livescoring;{key}={when}?{query}"}


def points(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Missing or invalid fantasy points')
    return value


def normalize(raw, t):
    team, owner, date = t['team_id'], t['owner'], t['scoring_date']
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
    if selected.get('teamId') != team:
        raise ValueError('Returned team differs from request')
    if selected.get('playerViewType', {}).get('id') != '2':
        raise ValueError('Full All Players Playing response required')
    period_label = None
    if t['sport'] == 'PGA':
        if data.get('period') != t['tournament_period'] or selected.get('period') != t['tournament_period']:
            raise ValueError('Returned tournament differs from request')
        if selected.get('viewType', {}).get('name') != 'Period':
            raise ValueError('Expected tournament period view')
        periods = [p for p in data['periods'] if p.get('object1') == t['tournament_period']]
        if len(periods) != 1 or not isinstance(periods[0].get('object2'), str):
            raise ValueError('Tournament label missing or ambiguous')
        period_label = periods[0]['object2']
        if data.get('allEventsFinished') is False:
            raise ValueError('Events explicitly unfinished')
    else:
        if data.get('date') != date or selected.get('date') != date:
            raise ValueError('Returned date differs from request')
        if selected.get('viewType', {}).get('name') != 'Day':
            raise ValueError('Expected daily view')
        if data.get('allEventsFinished') is not True:
            raise ValueError('Events unfinished or completion flag absent')
    if data['fantasyTeamInfo'][team]['name'] != owner:
        raise ValueError('Team identity changed')
    players, totals, seen = [], {}, set()
    groups = data['statsPerTeam']['allTeamsStats'][team]
    if set(groups) != {'ACTIVE', 'BENCH'}:
        raise ValueError('Unexpected lineup group')
    for group in ('ACTIVE', 'BENCH'):
        stats = groups[group]['statsMap']
        names = {}
        for rows in data['scorerMap'][group][team].values():
            for row in rows:
                scorer = row['scorer']; pid = scorer['scorerId']
                if not isinstance(pid, str) or not pid.strip() or not isinstance(scorer.get('name'), str) or not scorer['name'].strip():
                    raise ValueError('Missing player identity')
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
                **t,
                'scoring_date': date, 'lineup_group': group,
                'fantasy_points': value,
                'team_contribution': value if group == 'ACTIVE' else 0,
                'stat_record_present': pid in actual})
    return {'read_only': True, **t, 'scoring_scope': 'tournament' if t['sport'] == 'PGA' else 'day',
        'tournament_label': period_label, 'historical_test_data': True,
        'completion_status': 'unverified' if data.get('allEventsFinished') is not True else 'events_finished',
        'all_events_finished': data.get('allEventsFinished'), 'active_total': totals['ACTIVE'], 'bench_total': totals['BENCH'],
        'totals_reconcile': True, 'players': players,
        'missing_stat_records': [p['player_id'] for p in players if not p['stat_record_present']],
        'all_listed_players_have_stats': all(p['stat_record_present'] for p in players),
        'production_ready': False,
        'scope': 'Captured All Players Playing view; not a roster count or proof of finalized historical Best Ball eligibility. Missing player stat rows remain unknown, not invented zeros.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sport', required=True, choices=PROFILES)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--response', type=Path)
    mode.add_argument('--live', action='store_true')
    parser.add_argument('--date')
    parser.add_argument('--period', type=int)
    parser.add_argument('--team-id')
    parser.add_argument('--owner')
    args = parser.parse_args()
    stage = 'checking target'
    try:
        t = target(args.sport, args.date, args.period, args.team_id, args.owner)
        if args.response:
            stage = 'reading saved response'
            raw = json.loads(args.response.read_text(encoding='utf-8-sig'))
        else:
            stage = 'checking FANTRAX_COOKIE'
            cookie = os.environ.get('FANTRAX_COOKIE', '').strip()
            if not cookie: raise ValueError('FANTRAX_COOKIE is missing')
            import requests
            stage = 'requesting scoring (check session and network)'
            with requests.Session() as session:
                for part in cookie.split(';'):
                    if '=' in part:
                        key, value = part.strip().split('=', 1)
                        session.cookies.set(key.strip(), value.strip())
                response = session.post('https://www.fantrax.com/fxpa/req',
                    params={'leagueId':t['league_id']}, json=build_payload(t),
                    timeout=30, allow_redirects=False)
                if response.status_code != 200: raise RuntimeError('HTTP failure')
                raw = response.json()
        stage = 'validating response identity, scope, lineup and totals'
        result = normalize(raw, t)
        result['source'] = 'live' if args.live else 'saved_response'
        # A saved raw response has no trustworthy acquisition time here. Never
        # label its normalization time as a fresh Fantrax observation.
        result['observed_at'] = datetime.now(timezone.utc).isoformat() if args.live else None
        print(json.dumps(result, indent=2, allow_nan=False))
        return 0
    except Exception as exc:
        # Only our fixed validation messages are safe; never print transport/JSON exceptions.
        safe = type(exc) is ValueError and str(exc) in SAFE_ERRORS
        reason = str(exc) if safe else 'Missing/malformed response fields or connection failure; raw details withheld.'
        print(f'Scoring diagnostic failed while {stage}: {reason} No changes made.', file=sys.stderr)
        return 1


SAFE_ERRORS = {
    'Supply team ID and exact owner name together', 'Invalid team ID or owner name',
    'PGA requires a tournament period, not a date', 'Invalid tournament period',
    'Daily sports require a date, not a period', 'Use a valid YYYY-MM-DD date',
    'Missing or invalid fantasy points', 'API error or invalid response',
    'Expected the captured two-message response', 'Message error', 'Scoring response error',
    'Returned team differs from request', 'Full All Players Playing response required',
    'Returned tournament differs from request', 'Expected tournament period view',
    'Tournament label missing or ambiguous', 'Events explicitly unfinished',
    'Returned date differs from request', 'Expected daily view',
    'Events unfinished or completion flag absent', 'Team identity changed',
    'Unexpected lineup group', 'Missing player identity', 'Duplicate player identity',
    'Scoring record lacks player identity', 'Player points do not reconcile with lineup total',
    'FANTRAX_COOKIE is missing',
}

if __name__ == '__main__': sys.exit(main())
