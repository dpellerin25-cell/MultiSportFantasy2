"""Read only dated league metadata; never infer championship years or switch leagues."""
import json
import sys
from fantrax_connections import CONNECTIONS
from fetch_fantrax import create_session
from preview_fantrax_connections import BASE

def main():
    report = []
    with create_session() as session:
        for sport, rule in CONNECTIONS['sports'].items():
            response = session.get(BASE+'getLeagueInfo', params={'leagueId':rule['current_league_id']}, timeout=30, allow_redirects=False)
            if response.status_code != 200: raise ValueError('Metadata unavailable')
            data = response.json()
            if not isinstance(data,dict) or 'seasonYear' not in data: raise ValueError('Metadata missing')
            # Only allow known date/year fields; no raw response or credentials.
            dates = {key:data.get(key) for key in ('seasonYear','startDate','endDate')}
            if any(value is not None and not isinstance(value,(str,int,float)) for value in dates.values()):
                raise ValueError('Nested dates require a separately reviewed capture')
            report.append({'sport':sport,'league_id':rule['current_league_id'],**dates})
    print(json.dumps({'read_only':True,'mappings_approved':False,'results':report},indent=2))

if __name__ == '__main__':
    try: main()
    except Exception:
        print('Date diagnostic failed; no changes made or raw response printed.',file=sys.stderr)
        sys.exit(1)
