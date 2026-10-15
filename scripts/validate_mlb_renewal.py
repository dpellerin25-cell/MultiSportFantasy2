"""Read-only live MLB comparison. Prints a report; never updates local data or Supabase."""
import json
import argparse
import os
from pathlib import Path
import sys
from datetime import datetime, timezone
from fetch_fantrax import create_session, parse_roster
from diagnose_nfl_players import build_payload, validate_envelope, URL
from preview_fantrax_connections import metadata, BASE
from nfl_player_pool import collect_pool

OLD = '60ri2nbhmtj4b0km'
NEW = 'rk8bvnk3mulovx9a'
HISTORY = 'ml3fdlq2mulovxoh'


def read_rosters(request, league, expected):
    body = request(league, 'getStandings', {'leagueId': league})
    teams = body.get('fantasyTeamInfo')
    if not isinstance(teams, dict) or not teams or len(teams) > 50:
        raise ValueError('Missing or unexpected team list')
    names = [t.get('name') for t in teams.values()]
    if any(not isinstance(n, str) for n in names) or len(set(names)) != len(names):
        raise ValueError('Invalid or duplicate owner names')
    # Do not echo unrecognized team names from authenticated responses.
    membership = {'missing_owners': sorted(set(expected)-set(names)),
                  'unexpected_owner_count': len(set(names)-set(expected))}
    players, counts = {}, {}
    for team_id, team in teams.items():
        rows = parse_roster(request(league, 'getTeamRosterInfo',
                                   {'leagueId': league, 'teamId': team_id, 'view': 'SIMPLE'}))
        if team['name'] in expected:
            counts[team['name']] = len(rows)
        for p in rows:
            pid, name = p['player_id'], p['name']
            if not isinstance(pid, str) or not pid or not isinstance(name, str) or not name or pid in players:
                raise ValueError('Missing or duplicate roster player identity')
            players[pid] = {'player_name': name, 'owner': team_id}
    return {'membership': membership, 'counts': counts, 'players': players}


def validate(get, request, expected, progress=lambda s: None, *, include_identities=False):
    started = datetime.now(timezone.utc).isoformat()
    leagues = get('getLeagues', None).get('leagues')
    if not isinstance(leagues, list):
        raise ValueError('Missing account league list')
    for lid in (OLD, NEW):
        matches = [r for r in leagues if r.get('leagueId') == lid]
        if len(matches) != 1 or matches[0].get('sport') != 'MLB':
            raise ValueError('MLB league identity/sport not verified')
    metas = {lid: metadata(get('getLeagueInfo', lid)) for lid in (OLD, NEW)}
    if any(metas[lid] != {'league_history_id': HISTORY, 'season_year': year}
           for lid, year in ((OLD, 2026), (NEW, 2027))):
        raise ValueError('MLB history or season changed')
    results, identities, rosters = {}, {}, {}
    blockers = []
    for lid in (OLD, NEW):
        label = '2026' if lid == OLD else '2027'
        progress('Reading MLB '+label+' rosters')
        before = read_rosters(request, lid, expected)
        def fetch(page):
            progress(f'Reading MLB {label} available-player page {page}')
            return request(lid, 'getPlayerStats', build_payload(page)['msgs'][0]['data'] | {'positionOrGroup': 'ALL'})
        pool = collect_pool(fetch, lid, set(before['players']), 1000,
                            sport='MLB', position_filter='ALL', include_players=True)
        after = read_rosters(request, lid, expected)
        if before != after:
            raise ValueError('Roster changed during pool capture; rerun')
        if not pool['summary']['complete'] or pool['summary']['unknown_status_count']:
            raise ValueError('Incomplete pool or unidentified availability')
        if lid == NEW and (after['membership']['missing_owners'] or after['membership']['unexpected_owner_count']):
            blockers.append('New MLB league does not match approved membership')
        ids = {p['player_id']: p['player_name'] for p in pool['players']}
        ids.update({pid: p['player_name'] for pid, p in after['players'].items()})
        identities[lid], rosters[lid] = ids, after
        results[label] = {'league_id': lid, 'metadata': metas[lid], **after['membership'],
                          'roster_counts': after['counts'], 'rostered_players': len(after['players']),
                          'pool': pool['summary'], 'sample': pool['sample'], 'roster_recheck_unchanged': True}
    old_ids, new_ids = identities[OLD], identities[NEW]
    shared = set(old_ids) & set(new_ids)
    renamed = sorted(pid for pid in shared if old_ids[pid].strip().casefold() != new_ids[pid].strip().casefold())
    missing_rostered = sorted(set(rosters[OLD]['players'])-set(new_ids))
    if renamed:
        blockers.append('Shared IDs have differing player names; review before aliasing')
    if missing_rostered:
        blockers.append('Some old rostered players are absent from the new roster and available pool')
    if not shared:
        blockers.append('No shared player IDs found')
    # Metadata must still describe the same pair after the long paginated fetch.
    if any(metadata(get('getLeagueInfo', lid)) != metas[lid] for lid in (OLD, NEW)):
        raise ValueError('Metadata changed during capture')
    report = {'read_only': True, 'automatic_switch_performed': False,
            'started_at': started, 'completed_at': datetime.now(timezone.utc).isoformat(),
            'leagues': results, 'comparison': {'shared_player_ids': len(shared),
             'old_only_count': len(set(old_ids)-set(new_ids)), 'new_only_count': len(set(new_ids)-set(old_ids)),
             'old_only_sample': sorted(set(old_ids)-set(new_ids))[:20],
             'new_only_sample': sorted(set(new_ids)-set(old_ids))[:20],
             'name_difference_count': len(renamed), 'name_difference_sample': renamed[:20],
             'old_rostered_missing_count': len(missing_rostered), 'old_rostered_missing_sample': missing_rostered[:20]},
            'blockers': blockers, 'capture_checks_passed': not blockers,
            'scope': 'Sequential live roster and ALL_AVAILABLE reads, not an atomic snapshot or complete Fantrax player universe. Old-only IDs and database source mappings still require review before activation.'}
    if include_identities:
        report['identity_manifest'] = {
            'schema_version': 1, 'kind': 'mlb-renewal-identities',
            'started_at': started, 'completed_at': report['completed_at'],
            'capture_checks_passed': not blockers,
            'leagues': {lid: {'metadata': metas[lid], 'player_count': len(ids),
                              'players': [{'player_id': pid, 'player_name': name} for pid, name in sorted(ids.items())]}
                        for lid, ids in identities.items()}}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--identity-output', help='Save complete ID lists to a new file outside the repository for read-only database comparison')
    args = parser.parse_args()
    if not os.environ.get('FANTRAX_COOKIE') or not os.environ.get('FANTRAX_USER_SECRET_ID'):
        print('Set FANTRAX_COOKIE and FANTRAX_USER_SECRET_ID privately. No requests made.', file=sys.stderr)
        return 1
    secret = os.environ['FANTRAX_USER_SECRET_ID'].strip()
    stage = 'loading approved membership'
    try:
        root = Path(__file__).resolve().parents[1]
        output = Path(args.identity_output).resolve() if args.identity_output else None
        if output and (output.is_relative_to(root) or output.exists() or not output.parent.is_dir()):
            print('Identity output must be a new file outside the repository, in an existing directory. No requests made.', file=sys.stderr)
            return 1
        expected = [o['name'] for o in json.loads((root/'web/data/league-settings.json').read_text(encoding='utf-8-sig'))['owners']]
        with create_session() as session:
            def get(endpoint, lid):
                nonlocal stage
                stage = 'reading MLB metadata'
                response = session.get(BASE+endpoint, params={'userSecretId': secret} if lid is None else {'leagueId': lid}, timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('Metadata HTTP failure')
                return response.json()
            def request(lid, method, data):
                nonlocal stage
                stage = ('reading MLB 2026 ' if lid == OLD else 'reading MLB 2027 ') + method
                response = session.post(URL, params={'leagueId': lid}, json={'msgs': [{'method': method, 'data': data}]}, timeout=30, allow_redirects=False)
                if response.status_code != 200:
                    raise ValueError('League request HTTP failure')
                raw = response.json()
                if isinstance(raw, dict) and ('pageError' in raw or any(isinstance(r, dict) and 'pageError' in r for r in raw.get('responses', []))):
                    raise ValueError('Fantrax API error')
                validate_envelope(raw)
                return raw['responses'][0]['data']
            report = validate(get, request, expected, lambda s: print(s, file=sys.stderr), include_identities=bool(output))
        manifest = report.pop('identity_manifest', None)
        if output and report['capture_checks_passed']:
            stage = 'saving identity manifest'
            with output.open('x', encoding='utf-8') as dest:
                dest.write(json.dumps(manifest, indent=2).replace(secret, '[REDACTED]').replace(os.environ['FANTRAX_COOKIE'], '[REDACTED]'))
            report['identity_manifest_saved'] = True
        print(json.dumps(report, indent=2).replace(secret, '[REDACTED]').replace(os.environ['FANTRAX_COOKIE'], '[REDACTED]'))
        return 0 if report['capture_checks_passed'] else 2
    except Exception:
        print(f'MLB validation failed while {stage}: authentication, metadata, roster schema or pool completeness check failed. No production data changed. Raw errors omitted to protect credentials.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
