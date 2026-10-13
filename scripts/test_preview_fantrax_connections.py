import copy
import unittest
from preview_fantrax_connections import discover, ReadFailure
OLD='60ri2nbhmtj4b0km'
NEW='rk8bvnk3mulovx9a'
EXCLUDED='xtv5ph2gmulolm8g'
HISTORY='ml3fdlq2mulovxoh'

class PreviewTests(unittest.TestCase):
    def setUp(self):
        self.config={'excluded_league_ids':[EXCLUDED],'sports':{'MLB':{'current_league_id':OLD,'target_season_year':2027,'league_history_id':HISTORY}}}
        self.rows=[{'leagueId':OLD,'sport':'MLB'},{'leagueId':NEW,'sport':'MLB'},{'leagueId':EXCLUDED,'sport':'PGA'}]
        self.info={OLD:{'leagueHistoryId':HISTORY,'seasonYear':2026},NEW:{'leagueHistoryId':HISTORY,'seasonYear':2027}}
        self.calls=[]
    def get(self, endpoint, lid):
        self.calls.append((endpoint,lid))
        if endpoint=='getLeagues':return {'leagues':self.rows}
        return self.info[lid]
    def result(self):return discover(self.get,self.config)['results'][0]
    def test_exact_match_without_mutation_or_excluded_fetch(self):
        before=copy.deepcopy(self.config)
        result=self.result()
        self.assertEqual(result['proposed_league_id'],NEW)
        self.assertEqual(result['status'],'awaiting_commissioner_approval')
        self.assertEqual(self.config,before)
        self.assertNotIn(('getLeagueInfo',EXCLUDED),self.calls)
    def test_wrong_history_not_name_matching(self):
        self.info[NEW]['leagueHistoryId']='abcdefghijklmnop'
        self.assertIsNone(self.result()['proposed_league_id'])
    def test_ambiguous_target_blocks(self):
        self.info[OLD]['seasonYear']=2027
        self.assertIn('Multiple',self.result()['reason'])
    def test_missing_or_invalid_metadata_blocks(self):
        for bad in [{},{'seasonYear':2027,'leagueHistoryId':HISTORY,'error':'denied'}]:
            self.info[NEW]=bad
            self.assertEqual(self.result()['status'],'blocked')
    def test_target_required_and_newest_not_selected(self):
        self.config['sports']['MLB']['target_season_year']=None
        self.assertIsNone(self.result()['proposed_league_id'])
        self.config['sports']['MLB']['target_season_year']=2026
        self.assertEqual(self.result()['status'],'unchanged')
    def test_duplicate_and_empty_envelope_rejected(self):
        self.rows.append(self.rows[0])
        with self.assertRaises(ValueError):self.result()
        with self.assertRaises(ValueError):discover(lambda *_:{},self.config)
    def test_excluded_same_sport_cannot_be_selected(self):
        self.rows[-1]['sport']='MLB'
        self.info[EXCLUDED]={'leagueHistoryId':HISTORY,'seasonYear':2027}
        self.assertEqual(self.result()['proposed_league_id'],NEW)
        self.assertNotIn(('getLeagueInfo',EXCLUDED),self.calls)
    def test_sport_and_pinned_history_validated(self):
        self.rows[0]['sport']='PGA'
        self.assertEqual(self.result()['status'],'blocked')
        self.rows[0]['sport']='MLB'
        self.config['sports']['MLB']['league_history_id']='abcdefghijklmnop'
        self.assertIn('differs',self.result()['reason'])

    def test_missing_history_preserves_observed_season(self):
        self.info[OLD]={'seasonYear':2026}
        result=self.result()
        fields=result['current_metadata_diagnostic']['fields']
        self.assertEqual(fields['leagueHistoryId']['state'],'missing')
        self.assertEqual(fields['seasonYear']['observed_value'],2026)
        self.assertIsNone(result['proposed_league_id'])

    def test_null_and_cross_year_are_reported_without_coercion(self):
        self.info[OLD]={'leagueHistoryId':None,'seasonYear':'2026-27'}
        result=self.result()
        fields=result['current_metadata_diagnostic']['fields']
        self.assertEqual(fields['leagueHistoryId']['state'],'null')
        self.assertEqual(fields['seasonYear']['observed_value'],'2026-27')
        self.assertFalse(fields['seasonYear']['valid'])
        self.assertEqual(result['status'],'blocked')

    def test_private_values_and_api_error_text_are_not_printed(self):
        self.info[OLD]={'leagueHistoryId':'private-secret','seasonYear':'private-secret',
                        'pageError':{'text':'private-secret'},'private-secret':'private-secret'}
        result=self.result()
        self.assertNotIn('private-secret',str(result))
        self.assertEqual(result['current_metadata_diagnostic']['api_error_fields'],['pageError'])

    def test_transport_diagnostics_do_not_echo_exception(self):
        for failure in [ReadFailure('http_error',403),ReadFailure('invalid_json',200),
                        ReadFailure('timeout'), RuntimeError('private-secret')]:
            def get(endpoint,lid):
                if endpoint=='getLeagues':return {'leagues':self.rows}
                raise failure
            result=discover(get,self.config)['results'][0]
            self.assertEqual(result['status'],'blocked')
            self.assertNotIn('private-secret',str(result))
            self.assertIn('request_status',result['current_metadata_diagnostic'])

    def test_failed_candidate_has_specific_diagnostic(self):
        self.info[NEW]={'leagueHistoryId':HISTORY,'seasonYear':True}
        result=self.result()
        self.assertFalse(result['candidate_diagnostics'][NEW]['fields']['seasonYear']['valid'])
        self.assertEqual(result['status'],'blocked')

    def test_unrenewed_approved_connection_and_later_renewal(self):
        del self.config['sports']['MLB']['league_history_id']
        self.info[OLD]={'seasonYear':2026}
        before=copy.deepcopy(self.config)
        self.assertEqual(self.result()['status'],'awaiting_renewal')
        self.assertIsNone(self.result()['proposed_league_id'])
        self.config['sports']['MLB']['target_season_year']=2026
        self.assertEqual(self.result()['status'],'unchanged')
        self.assertEqual(self.result()['proposed_league_id'],OLD)
        self.config=before
        self.info[OLD]['leagueHistoryId']=HISTORY
        self.assertEqual(self.result()['proposed_league_id'],NEW)
        self.assertEqual(self.config,before)

    def test_missing_history_cannot_match_unrelated_candidate(self):
        del self.config['sports']['MLB']['league_history_id']
        self.info[OLD]={'seasonYear':2026}
        self.info[NEW]={'seasonYear':2027}
        self.assertIsNone(self.result()['proposed_league_id'])
        self.info[OLD]['leagueHistoryId']=HISTORY
        self.assertIsNone(self.result()['proposed_league_id'])

    def test_pinned_history_disappearance_still_blocks(self):
        self.info[OLD]={'seasonYear':2026}
        self.assertEqual(self.result()['status'],'blocked')

    def test_explicit_invalid_history_is_not_unrenewed(self):
        del self.config['sports']['MLB']['league_history_id']
        for history in [None,'',False,'bad']:
            self.info[OLD]={'seasonYear':2026,'leagueHistoryId':history}
            self.assertEqual(self.result()['status'],'blocked')

if __name__=='__main__':unittest.main()
