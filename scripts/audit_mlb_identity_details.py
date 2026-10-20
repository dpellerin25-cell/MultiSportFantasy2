"""Read-only identity review: saved renewal audit plus two verified getLeagueInfo reads.

Never approves mappings or changes players. No player-search method is guessed.
"""
import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from fetch_fantrax import create_session
from preview_fantrax_connections import BASE, metadata

OLD = '60ri2nbhmtj4b0km'
NEW = 'rk8bvnk3mulovx9a'
HISTORY = 'ml3fdlq2mulovxoh'
FIELDS = {'id', 'playerId', 'scorerId', 'name', 'firstName', 'lastName',
          'shortName', 'urlName', 'position', 'posShortNames', 'teamName',
          'teamShortName', 'sport', 'birthDate', 'dateOfBirth'}


def normalized(name):
    return ''.join(c for c in unicodedata.normalize('NFKD', name).casefold()
                   if c.isalnum())


def review(report):
    if report.get('sport') != 'MLB' or report.get('old_league_id') != OLD or report.get('new_league_id') != NEW:
        raise ValueError('Wrong league pair')
    missing = report['missing_player_details']
    changed = report['identity_difference_details']
    if not isinstance(missing, list) or not isinstance(changed, list) or len(missing)+len(changed)>1000:
        raise ValueError('Invalid review details')
    rows = missing + changed
    for r in rows:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}', r['player_id']):
            raise ValueError('Invalid player ID')
        if not r['stored_records'] or any(not isinstance(p.get('name'), str) for p in r['stored_records']):
            raise ValueError('Invalid stored identities')
    output=[]
    for r in rows:
        names=sorted({p['name'] for p in r['stored_records']})
        captured=r['captured_name']
        other_ids=sorted({other['player_id'] for other in rows
                          if other['player_id']!=r['player_id'] and captured
                          and any(normalized(p['name'])==normalized(captured) for p in other['stored_records'])})
        kind=('absent_from_capture' if captured is None else
              'cross_id_name_collision' if other_ids else
              'formatting_only_candidate' if all(normalized(n)==normalized(captured) for n in names) else
              'name_change_requires_verification')
        output.append({'player_id':r['player_id'],'stored_names':names,'captured_name':captured,
                       'classification':kind,'other_stored_ids_with_captured_name':other_ids,
                       'stored_references':r['stored_records']})
    return output


def metadata_evidence(raw, targets):
    """Inspect only playerInfo; retain only explicitly allowed scalar player fields.

    The shape is unverified. An ID key or explicit ID value is evidence of a
    reference, not proof that Fantrax guarantees cross-season identity stability.
    """
    if not isinstance(raw, dict) or 'playerInfo' not in raw:
        return {'player_info_present':False,'matches':{}}
    found={}
    visited=0
    def walk(value, depth=0, keyed_id=None):
        nonlocal visited
        visited+=1
        if visited>500000 or depth>20:
            raise ValueError('Metadata traversal bound exceeded')
        if isinstance(value, dict):
            ids={str(value[k]) for k in ('id','playerId','scorerId') if k in value} & targets
            if keyed_id: ids.add(keyed_id)
            fields={k:v for k,v in value.items() if k in FIELDS and isinstance(v,(str,int))
                    and not isinstance(v,bool) and len(str(v))<=300}
            for pid in sorted(ids):
                records=found.setdefault(pid,[])
                if fields not in records:
                    if len(records)>=20: raise ValueError('Ambiguous metadata bound exceeded')
                    records.append(fields)
            for k,v in value.items():
                if isinstance(v,(dict,list)): walk(v,depth+1,k if k in targets else None)
        elif isinstance(value,list):
            for v in value: walk(v,depth+1,keyed_id)
    walk(raw['playerInfo'])
    return {'player_info_present':True,'matches':found}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--report',required=True,help='Saved output from yearly-renewals.mjs audit')
    p.add_argument('--offline',action='store_true',help='Review saved names only; no Fantrax requests')
    args=p.parse_args()
    stage='reading saved audit'
    try:
        rows=review(json.loads(Path(args.report).read_text(encoding='utf-8-sig')))
        evidence={}
        if not args.offline:
            stage='reading verified league metadata'
            with create_session() as session:
                for lid,year in [(OLD,2026),(NEW,2027)]:
                    print(f'Reading MLB {year} metadata only',file=sys.stderr)
                    response=session.get(BASE+'getLeagueInfo',params={'leagueId':lid},timeout=30,allow_redirects=False)
                    if response.status_code!=200: raise ValueError('Metadata HTTP failure')
                    raw=response.json()
                    m=metadata(raw)
                    if m['league_history_id']!=HISTORY or m['season_year']!=year:
                        raise ValueError('League metadata mismatch')
                    evidence[str(year)]=metadata_evidence(raw,{r['player_id'] for r in rows})
        result={'read_only':True,'automatic_switch_performed':False,'mappings_approved':False,
                'scope':'Saved capture names; optional current league metadata. Absence does not prove retirement or deletion. No guessed player-search calls.',
                'counts':{k:sum(r['classification']==k for r in rows) for k in sorted({r['classification'] for r in rows})},
                'players':rows,'league_metadata_evidence':evidence,
                'next_evidence_if_unresolved':'In Fantrax open the affected player cards in both leagues. Capture the actual Network request URL/method/payload and response showing player ID, full name, team/position and other distinguishing details. For Luke Pelzer inspect both 06zar and 074vs. Remove Cookie/Authorization/user secrets before sharing. Do not infer that equal names mean equal players.'}
        text=json.dumps(result,indent=2)
        for key in ['FANTRAX_COOKIE','FANTRAX_USER_SECRET_ID']:
            secret=os.environ.get(key)
            if secret: text=text.replace(secret,'[REDACTED]')
        print(text)
        return 0
    except Exception:
        print(f'Identity detail audit failed while {stage}. No changes made; raw errors withheld to protect credentials.',file=sys.stderr)
        return 1


if __name__=='__main__':
    sys.exit(main())
