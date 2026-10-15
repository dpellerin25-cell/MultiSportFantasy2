"""Approved connections shared with Node importers. Discovery never edits this file."""
import json
from pathlib import Path
import re
import os

def load_connections():
    data = json.loads(Path(os.environ.get('FANTRAX_CONNECTIONS_FILE', Path(__file__).with_name('fantrax-connections.json'))).read_text(encoding='utf-8'))
    if set(data['sports']) != {'NFL','MLB','NBA','EPL','PGA'}:
        raise ValueError('Exactly five connections required')
    ids = [v['current_league_id'] for v in data['sports'].values()]
    if len(set(ids)) != 5 or any(not re.fullmatch('[a-z0-9]{16}', x) or x in data['excluded_league_ids'] for x in ids):
        raise ValueError('Invalid approved connection')
    return data

CONNECTIONS = load_connections()
