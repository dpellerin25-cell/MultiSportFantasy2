import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock
from diagnose_scoring import target
from fetch_scheduled_scoring import collect


class ScheduledCaptureTests(unittest.TestCase):
    def test_real_five_sport_fixtures(self):
        for sport, total in {'NFL': 20.45, 'MLB': 1, 'NBA': 124, 'EPL': 8, 'PGA': 127}.items():
            raw = json.loads((Path(__file__).parent/'fixtures/scoring'/f'{sport.lower()}.json').read_text())
            session = Mock()
            session.post.return_value.status_code = 200
            session.post.return_value.json.return_value = raw
            result = collect(target(sport), session)
            self.assertEqual(result['diagnostic']['active_total'], total)
            self.assertIn('observed_at', result)
            self.assertEqual(session.post.call_args.kwargs['params']['leagueId'], target(sport)['league_id'])
            self.assertFalse(session.post.call_args.kwargs['allow_redirects'])

    def test_synthetic_wrong_date_and_unfinished_are_rejected(self):
        raw = json.loads((Path(__file__).parent/'fixtures/scoring/mlb.json').read_text())
        for key, value in [('date', '2026-09-22'), ('allEventsFinished', False)]:
            data = copy.deepcopy(raw)
            data['responses'][0]['data'][key] = value
            session = Mock()
            session.post.return_value.status_code = 200
            session.post.return_value.json.return_value = data
            with self.assertRaises(ValueError):
                collect(target('MLB'), session)


if __name__ == '__main__':
    unittest.main()
