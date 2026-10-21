"""League calendar is independent of unverified Fantrax year conventions."""
import json
from pathlib import Path

CALENDAR = json.loads((Path(__file__).resolve().parents[1] / 'web/data/championship-calendar.json').read_text())


def championship_year(sport, fantrax_year):
    offset = CALENDAR['sports'][sport]['fantrax_to_championship_offset']
    if offset is None:
        raise ValueError(f'{sport}: Fantrax seasonYear convention requires captured date evidence')
    if type(fantrax_year) is not int:
        raise ValueError('Integer Fantrax season year required')
    year = fantrax_year + offset
    if year < CALENDAR['first_championship_year']:
        raise ValueError('Pre-launch season is not a Pentagon Cup championship')
    return year
