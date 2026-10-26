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

    def test_explicit_other_owner_and_date(self):
        # Synthetic parameter test, not evidence of another real scoring day.
        team, date = 'otherteam123', '2026-09-25'
        self.data['date'] = date
        self.data['displayedSelections'].update(date=date, teamId=team)
        self.data['fantasyTeamInfo'] = {team: {'name': 'Other Owner'}}
        teams = self.data['statsPerTeam']['allTeamsStats']
        teams[team] = teams.pop(TEAM)
        for group in ('ACTIVE', 'BENCH'):
            scorers = self.data['scorerMap'][group]
            scorers[team] = scorers.pop(TEAM)
        result = normalize(self.raw, date, team, 'Other Owner')
        self.assertTrue(all(p['owner'] == 'Other Owner' and p['scoring_date'] == date for p in result['players']))
        payload = build_payload(date, team)
        self.assertEqual(payload['msgs'][0]['data']['teamId'], team)
        self.assertEqual(payload['msgs'][0]['data']['date'], date)
        self.assertIn('date=2026-09-25', payload['refUrl'])

    def test_owner_mismatch_rejected(self):
        with self.assertRaises(ValueError): normalize(self.raw, owner='Another Owner')

    def test_explicit_zero_is_distinct_from_missing(self):
        stats = self.data['statsPerTeam']['allTeamsStats'][TEAM]['ACTIVE']['statsMap']
        stats['062k5'] = {'object1': 0}
        result = normalize(self.raw)
        rows = {p['player_id']: p for p in result['players']}
        self.assertEqual(rows['062k5']['team_contribution'], 0)
        self.assertTrue(rows['062k5']['stat_record_present'])
        self.assertIsNone(rows['03oh0']['team_contribution'])
        self.assertEqual(result['missing_stat_records'], ['03oh0'])
        self.assertFalse(result['all_listed_players_have_stats'])
        self.assertFalse(result['production_ready'])

    def test_invalid_target_rejected(self):
        for date in ('2026-02-30', '09/24/2026', '20260924'):
            with self.assertRaises(ValueError): build_payload(date)
        with self.assertRaises(ValueError): build_payload(team='bad&id=1')

    def test_unidentified_stats_rejected(self):
        self.data['statsPerTeam']['allTeamsStats'][TEAM]['ACTIVE']['statsMap']['unknown'] = {'object1': 0}
        with self.assertRaises(ValueError): normalize(self.raw)

    def test_nonfinite_points_rejected(self):
        for value in (float('nan'), float('inf'), True, '1'):
            self.data['statsPerTeam']['allTeamsStats'][TEAM]['ACTIVE']['statsMap']['02mwm']['object1'] = value
            with self.assertRaises(ValueError): normalize(self.raw)

if __name__=='__main__':unittest.main()
