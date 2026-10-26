import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
import io
from contextlib import redirect_stderr, redirect_stdout
from diagnose_scoring import target, build_payload, normalize, main, PROFILES

ROOT = Path(__file__).parent/'fixtures/scoring'

class SharedScoringTests(unittest.TestCase):
    def fixture(self, sport):
        return json.loads((ROOT/f'{sport.lower()}.json').read_text())

    def test_actual_five_sport_captures(self):
        for sport, expected in {'MLB':(1,2),'NFL':(20.45,25.35),'NBA':(124,8),'EPL':(8,0),'PGA':(127,0)}.items():
            with self.subTest(sport=sport):
                r=normalize(self.fixture(sport),target(sport))
                self.assertEqual((r['active_total'],r['bench_total']),expected)
                self.assertTrue(r['totals_reconcile'])
                self.assertFalse(r['production_ready'])
                self.assertTrue(r['historical_test_data'])
                self.assertTrue(all(p['team_contribution']==0 for p in r['players'] if p['lineup_group']=='BENCH'))
                self.assertTrue(all(p['sport']==sport and p['league_id']==PROFILES[sport][0] for p in r['players']))

    def test_observed_request_patterns(self):
        for sport in PROFILES:
            p=build_payload(target(sport));d=p['msgs'][0]['data']
            self.assertEqual([m['method'] for m in p['msgs']],['getLiveScoringStats','getScoresSummaryData'])
            self.assertTrue(d['newView'])
            self.assertEqual(d['teamId'],PROFILES[sport][1])
            if sport=='PGA':
                self.assertEqual(d['period'],'21'); self.assertNotIn('date',d)
            else: self.assertEqual(d['date'],PROFILES[sport][3])
            if sport=='EPL': self.assertEqual(d['reload'],'1');self.assertNotIn('playerViewType',d)

    def test_pga_not_misrepresented_as_daily_or_final(self):
        r=normalize(self.fixture('PGA'),target('PGA'))
        self.assertEqual(r['completion_status'],'unverified')
        self.assertIsNone(r['scoring_date'])
        self.assertEqual(r['tournament_period'],21)
        self.assertIn('RBC Canadian Open',r['tournament_label'])

    # Following mutations are synthetic edge cases, not further live captures.
    def test_zero_missing_and_negative(self):
        raw=self.fixture('NFL');t=target('NFL');g=raw['responses'][0]['data']['statsPerTeam']['allTeamsStats'][t['team_id']]['ACTIVE']
        pid=next(k for k in g['statsMap'] if not k.startswith('_'))
        for number in (0,-4.5):
            g['statsMap'][pid]['object1']=number;g['totalFpts']=number
            r=normalize(raw,t);p=next(p for p in r['players'] if p['player_id']==pid)
            self.assertEqual(p['team_contribution'],number); self.assertTrue(p['stat_record_present'])
        del g['statsMap'][pid];g['totalFpts']=0
        r=normalize(raw,t);p=next(p for p in r['players'] if p['player_id']==pid)
        self.assertIsNone(p['fantasy_points']);self.assertIsNone(p['team_contribution'])
        self.assertIn(pid,r['missing_stat_records'])

    def test_invalid_scope_identity_and_completion(self):
        for sport in PROFILES:
            t=target(sport)
            mutations=[lambda d:d['displayedSelections'].update(teamId='wrong'),
                       lambda d:d['fantasyTeamInfo'][t['team_id']].update(name='Wrong'),
                       lambda d:d['displayedSelections'].update(playerViewType={'id':'1'}),
                       lambda d:d.update(allEventsFinished=False),
                       lambda d:d['displayedSelections'].update(viewType={'name':'Season'})]
            if sport=='PGA':mutations.append(lambda d:d.update(period=22))
            else:mutations.append(lambda d:d.update(date='2026-01-01'))
            for mutate in mutations:
                raw=self.fixture(sport);mutate(raw['responses'][0]['data'])
                with self.assertRaises((ValueError,KeyError)):normalize(raw,t)

    def test_groups_and_reconciliation(self):
        for sport in PROFILES:
            raw=self.fixture(sport);t=target(sport);groups=raw['responses'][0]['data']['statsPerTeam']['allTeamsStats'][t['team_id']]
            groups['ACTIVE']['totalFpts']+=1
            with self.assertRaises(ValueError):normalize(raw,t)
            raw=self.fixture(sport);del raw['responses'][0]['data']['statsPerTeam']['allTeamsStats'][t['team_id']]['BENCH']
            with self.assertRaises(ValueError):normalize(raw,t)

    def test_duplicate_and_unidentified_players(self):
        raw=self.fixture('NFL');t=target('NFL');d=raw['responses'][0]['data']
        rows=next(iter(d['scorerMap']['ACTIVE'][t['team_id']].values()))
        rows.append(copy.deepcopy(rows[0]))
        with self.assertRaises(ValueError):normalize(raw,t)
        raw=self.fixture('NFL');raw['responses'][0]['data']['statsPerTeam']['allTeamsStats'][t['team_id']]['ACTIVE']['statsMap']['unidentified']={'object1':0}
        with self.assertRaises(ValueError):normalize(raw,t)

    def test_non_numeric_points(self):
        for value in (True,'1',None,float('nan'),float('inf')):
            raw=self.fixture('NFL');t=target('NFL');g=raw['responses'][0]['data']['statsPerTeam']['allTeamsStats'][t['team_id']]['ACTIVE']
            g['totalFpts']=value
            with self.assertRaises(ValueError):normalize(raw,t)

    def test_errors_and_partial_envelopes(self):
        for raw in ({'pageError':{'code':'WARNING_NOT_LOGGED_IN'}},{'responses':[]},{'responses':[{'pageError':{'text':'SECRET'}},{}]}):
            with self.assertRaises(ValueError):normalize(raw,target('NFL'))

    def test_target_validation(self):
        for kwargs in ({'date':'2026-02-30'},{'period':21},{'team':'onlyteam'}):
            with self.assertRaises(ValueError):target('NFL',**kwargs)
        for kwargs in ({'date':'2026-10-25'},{'period':0}):
            with self.assertRaises(ValueError):target('PGA',**kwargs)
        t=target('MLB',date='2026-09-23',team='y7t2k7ypmvhgidn7',owner='Billy')
        self.assertEqual(build_payload(t)['msgs'][0]['data']['teamId'],'y7t2k7ypmvhgidn7')

    def test_cli_offline_no_network_and_sanitized_failure(self):
        args=['diagnose_scoring.py','--sport','PGA','--response',str(ROOT/'pga.json')]
        with patch('sys.argv',args),redirect_stdout(io.StringIO()) as output:
            self.assertEqual(main(),0)
        self.assertEqual(json.loads(output.getvalue())['source'],'saved_response')
        with patch('sys.argv',args),patch('diagnose_scoring.normalize',side_effect=ValueError('SECRET_COOKIE')),redirect_stderr(io.StringIO()) as error:
            self.assertEqual(main(),1)
        self.assertNotIn('SECRET_COOKIE',error.getvalue())
        self.assertIn('validating response',error.getvalue())

    def test_live_transport_is_single_scoped_read_and_rejects_redirect(self):
        transport = MagicMock()
        session = transport.Session.return_value.__enter__.return_value
        response = session.post.return_value
        response.status_code = 200
        response.json.return_value = self.fixture('PGA')
        args = ['diagnose_scoring.py', '--sport', 'PGA', '--live']
        with patch.dict('sys.modules', {'requests': transport}), patch.dict('os.environ', {'FANTRAX_COOKIE':'session=PRIVATE_TEST_VALUE'}), patch('sys.argv',args), redirect_stdout(io.StringIO()) as out:
            self.assertEqual(main(), 0)
        self.assertEqual(session.post.call_count, 1)
        call = session.post.call_args
        self.assertEqual(call.args[0], 'https://www.fantrax.com/fxpa/req')
        self.assertEqual(call.kwargs['params'], {'leagueId':PROFILES['PGA'][0]})
        self.assertEqual(call.kwargs['timeout'], 30)
        self.assertFalse(call.kwargs['allow_redirects'])
        self.assertNotIn('PRIVATE_TEST_VALUE',out.getvalue())
        response.status_code = 302
        with patch.dict('sys.modules', {'requests': transport}), patch.dict('os.environ', {'FANTRAX_COOKIE':'session=PRIVATE_TEST_VALUE'}), patch('sys.argv',args), redirect_stderr(io.StringIO()) as err:
            self.assertEqual(main(), 1)
        self.assertNotIn('PRIVATE_TEST_VALUE',err.getvalue())

if __name__=='__main__':unittest.main()
