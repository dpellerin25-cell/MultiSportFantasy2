import copy
import json
from pathlib import Path
import unittest
from diagnose_mlb_scoring import build_payload, normalize, TEAM, DATE

class ScoringDiagnosticTests(unittest.TestCase):
    def setUp(self):
        self.raw=json.loads((Path(__file__).parent/'fixtures/mlb-scoring-2026-09-24.json').read_text())
        self.data=self.raw['responses'][0]['data']

    def test_verified_request(self):
        payload=build_payload()
        self.assertEqual([m['method'] for m in payload['msgs']],['getLiveScoringStats','getScoresSummaryData'])
        self.assertEqual(payload['msgs'][0]['data']['date'],DATE)
        self.assertEqual(payload['msgs'][0]['data']['teamId'],TEAM)
        self.assertTrue(payload['msgs'][0]['data']['newView'])

    def test_captured_totals_and_bench_exclusion(self):
        result=normalize(self.raw)
        self.assertEqual(result['active_total'],1)
        self.assertEqual(result['bench_total'],2)
        rows={r['player_name']:r for r in result['players']}
        self.assertEqual(rows['Matt Olson']['team_contribution'],1)
        self.assertEqual(rows['Freddie Freeman']['team_contribution'],0)
        self.assertIsNone(rows['Nick Kurtz']['fantasy_points'])

    def test_wrong_date_team_or_unfinished_rejected(self):
        for change in [('date','2026-09-23'),('allEventsFinished',False)]:
            raw=copy.deepcopy(self.raw);raw['responses'][0]['data'][change[0]]=change[1]
            with self.assertRaises(ValueError):normalize(raw)
        self.data['displayedSelections']['teamId']='other'
        with self.assertRaises(ValueError):normalize(self.raw)

    def test_total_mismatch_rejected(self):
        self.data['statsPerTeam']['allTeamsStats'][TEAM]['ACTIVE']['totalFpts']=3
        with self.assertRaises(ValueError):normalize(self.raw)

    def test_negative_active_points_preserved(self):
        group=self.data['statsPerTeam']['allTeamsStats'][TEAM]['ACTIVE']
        group['statsMap']['02mwm']['object1']=-2
        group['totalFpts']=-2
        self.assertEqual(normalize(self.raw)['active_total'],-2)

    def test_duplicate_player_rejected(self):
        rows=self.data['scorerMap']['ACTIVE'][TEAM]['10']
        rows.append(copy.deepcopy(rows[-1]))
        with self.assertRaises(ValueError):normalize(self.raw)

    def test_api_error_rejected(self):
        self.raw['pageError']={'code':'WARNING_NOT_LOGGED_IN'}
        with self.assertRaises(ValueError):normalize(self.raw)

if __name__=='__main__':unittest.main()
