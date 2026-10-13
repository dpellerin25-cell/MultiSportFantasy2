import copy
import unittest
from preview_fantrax_connections import discover
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
        self.assertEqual(self.result()['status'],'blocked')

if __name__=='__main__':unittest.main()
