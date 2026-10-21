"""Save fresh old-league standings before automatic roster handoff. No DB writes."""
import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from fantrax_connections import CONNECTIONS
from fetch_fantrax import create_session, fantrax_request, find_standings_table, parse_standings_table
from yearly_renewals import automatic_due

ROOT = Path(__file__).resolve().parents[1]
FILES = {'NFL': 'nfl', 'MLB': 'mlb', 'NBA': 'nba', 'EPL': 'premier-league', 'PGA': 'pga'}


def validate_preview(preview, capture):
    if preview.get('blockers') != [] or any(preview.get(key) != capture[key] for key in ('sport', 'old_league_id', 'new_league_id')):
        raise ValueError('Successful matching database preview required before archiving')


def archive_capture(capture, registry, settings, read_standings, history):
    sport = capture['sport']
    rule = registry['sports'][sport]
    old = capture['old_league_id']
    if not capture.get('capture_checks_passed') or old != rule['current_league_id']:
        raise ValueError('Capture does not match current connection')
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(capture['started_at'])).total_seconds()
    if not 0 <= age < 21600:
        raise ValueError('Capture is stale')
    year = capture['old_season_year'] + (1 if sport in ('NFL', 'NBA', 'EPL') else 0)
    if year != rule.get('standings_championship_year', registry['championship_year']) or year != settings['championship_year']:
        raise ValueError('Old season is not the configured championship; review pre-launch or unreleased seasons')
    if rule.get('standings_league_id', old) != old:
        raise ValueError('A previous standings season is still awaiting release')
    directory = Path(history) / str(year)
    filename = FILES[sport] + '.json'
    path = directory / filename
    label = 'Premier League' if sport == 'EPL' else sport
    meta_path = directory / 'archive-metadata.json'
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {'year': year, 'sports': {}}
    if meta.get('year') != year or not isinstance(meta.get('sports'), dict):
        raise ValueError('Invalid archive metadata')
    if path.exists():
        saved = json.loads(path.read_text())
        if saved.get('league_id') != old or saved.get('championship_year') != year or saved.get('sport') != label:
            raise ValueError('Conflicting archive; never overwrite')
        if meta['sports'].get(label, {}).get('filename') != filename:
            raise ValueError('Existing archive is missing metadata; review before retry')
        return {'sport': sport, 'year': year, 'already_archived': True}
    if label in meta['sports']:
        raise ValueError('Archive metadata exists without standings')
    rows = read_standings(old)
    expected = {owner['name'] for owner in settings['owners']}
    if len(rows) != len(expected) or {r.get('team') for r in rows} != expected or len({r.get('team_id') for r in rows}) != len(rows):
        raise ValueError('Incomplete or duplicate archived membership')
    for row in rows:
        if not isinstance(row.get('team_id'), str) or not row['team_id'] or not str(row.get('rank', '')).isdigit() or not 1 <= int(row['rank']) <= len(rows):
            raise ValueError('Invalid standings identity or rank')
        if not math.isfinite(float(row['fantasyPoints'])):
            raise ValueError('Invalid standings score')
    points = settings['placement_points']
    if len(points) != len(rows):
        raise ValueError('Placement table does not match standings')
    now = datetime.now(timezone.utc).isoformat()
    output = {'sport': label, 'league_id': old, 'championship_year': year,
              'updated_at': now, 'team_count': len(rows), 'placement_points': points, 'standings': rows}
    meta['sports'][label] = {'filename': filename, 'archived_at': now,
                             'reason': 'renewed_league_detected', 'renewed_league_id': capture['new_league_id']}
    directory.mkdir(parents=True, exist_ok=True)
    # A partial local write is never published by the workflow: both files must succeed.
    with path.open('x', encoding='utf-8') as stream:
        json.dump(output, stream, indent=2)
    temporary = meta_path.with_suffix('.tmp')
    temporary.write_text(json.dumps(meta, indent=2), encoding='utf-8')
    temporary.replace(meta_path)
    return {'sport': sport, 'year': year, 'already_archived': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    settings = json.loads((ROOT / 'web/data/league-settings.json').read_text(encoding='utf-8-sig'))
    policy = json.loads((ROOT / 'scripts/fantrax-renewal-policy.json').read_text())
    with create_session() as session:
        def read(league):
            data = fantrax_request(session, league, 'getStandings', {'leagueId': league})
            table = find_standings_table(data)
            if table is None:
                raise ValueError('Missing standings table')
            return parse_standings_table(table)
        for sport in FILES:
            path = Path(args.directory) / f'{sport}-capture.json'
            if not path.exists():
                continue
            capture = json.loads(path.read_text())
            if capture.get('sport') != sport:
                raise ValueError('Capture sport mismatch')
            if automatic_due(policy['sports'][sport], capture['season_year']):
                preview = json.loads((Path(args.directory) / f'{sport}-preview.json').read_text())
                validate_preview(preview, capture)
                print(json.dumps(archive_capture(capture, CONNECTIONS, settings, read, ROOT / 'web/data/history')))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        raise SystemExit('Automatic archive failed. No standings release requested. Check capture, membership, championship year and existing archive; raw response withheld.')
