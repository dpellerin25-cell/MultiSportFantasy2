import copy
import json
from pathlib import Path
import unittest
from validate_mlb_renewal import validate, OLD, NEW, HISTORY


class RenewalCaptureTests(unittest.TestCase):
    def setUp(self):
        self.body = json.loads((Path(__file__).parent/'fixtures/mlb-player-page1.json').read_text())
        self.body['statsTable'] = self.body['statsTable'][:1]
        self.body['paginatedResultSet'].update(totalNumPages=1, totalNumResults=1)
        self.teams = {OLD: {'a': {'name': 'Doug'}}, NEW: {'a': {'name': 'Doug'}}}
        self.rows = []
        self.calls = []
        self.year = 2027

    def get(self, method, lid):
        if method == 'getLeagues':
            return {'leagues': [{'leagueId': x, 'sport': 'MLB'} for x in (OLD, NEW)]}
        return {'leagueHistoryId': HISTORY, 'seasonYear': 2026 if lid == OLD else self.year}

    def request(self, lid, method, data):
        self.calls.append((lid, method, data))
        if method == 'getStandings':
            return {'fantasyTeamInfo': copy.deepcopy(self.teams[lid])}
        if method == 'getTeamRosterInfo':
            return {'tables': [{'rows': copy.deepcopy(self.rows)}]}
        if method == 'getPlayerStats':
            self.assertEqual(data['statusOrTeamFilter'], 'ALL_AVAILABLE')
            self.assertEqual(data['positionOrGroup'], 'ALL')
            return copy.deepcopy(self.body)
        raise AssertionError('Unexpected method')

    def test_valid_pair_empty_rosters_and_identity_comparison(self):
        result = validate(self.get, self.request, ['Doug'])
        self.assertTrue(result['capture_checks_passed'])
        self.assertEqual(result['comparison']['shared_player_ids'], 1)
        self.assertEqual(result['leagues']['2027']['roster_counts'], {'Doug': 0})
        self.assertFalse(result['automatic_switch_performed'])
        self.assertEqual(sum(m == 'getTeamRosterInfo' for _, m, _ in self.calls), 4)

    def test_wrong_season_rejected_before_roster_fetch(self):
        self.year = 2028
        with self.assertRaises(ValueError):
            validate(self.get, self.request, ['Doug'])
        self.assertEqual(self.calls, [])

    def test_new_membership_missing_is_blocker(self):
        result = validate(self.get, self.request, ['Doug', 'John'])
        self.assertFalse(result['capture_checks_passed'])
        self.assertEqual(result['leagues']['2027']['missing_owners'], ['John'])

    def test_available_rostered_overlap_rejected(self):
        self.rows = [{'scorer': self.body['statsTable'][0]['scorer']}]
        with self.assertRaisesRegex(ValueError, 'contains roster'):
            validate(self.get, self.request, ['Doug'])

    def test_roster_changes_rejected(self):
        counts = {}
        def request(lid, method, data):
            result = self.request(lid, method, data)
            if method == 'getTeamRosterInfo':
                counts[lid] = counts.get(lid, 0)+1
                if counts[lid] == 2:
                    result['tables'][0]['rows'] = [{'scorer': {'scorerId': 'new-id', 'name': 'New Player'}}]
            return result
        with self.assertRaisesRegex(ValueError, 'Roster changed'):
            validate(self.get, request, ['Doug'])

    def test_incomplete_page_rejected(self):
        self.body['paginatedResultSet']['totalNumResults'] = 2
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            validate(self.get, self.request, ['Doug'])

    def test_name_mismatch_requires_review(self):
        def request(lid, method, data):
            result = self.request(lid, method, data)
            if lid == NEW and method == 'getPlayerStats':
                result['statsTable'][0]['scorer']['name'] = 'Different Player'
            return result
        result = validate(self.get, request, ['Doug'])
        self.assertFalse(result['capture_checks_passed'])
        self.assertEqual(result['comparison']['name_difference_count'], 1)

    def test_duplicate_roster_identity_rejected(self):
        self.rows = [{'scorer': {'scorerId': 'rostered', 'name': 'Roster Player'}}]*2
        with self.assertRaisesRegex(ValueError, 'duplicate roster'):
            validate(self.get, self.request, ['Doug'])


if __name__ == '__main__':
    unittest.main()
