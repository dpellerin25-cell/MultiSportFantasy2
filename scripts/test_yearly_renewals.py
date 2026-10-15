import copy
import json
from pathlib import Path
import unittest
from yearly_renewals import capture

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.old='60ri2nbhmtj4b0km'
        self.new='rk8bvnk3mulovx9a'
        self.candidate={'current_league_id':self.old,'proposed_league_id':self.new,'target_season_year':2027}
        self.body=json.loads((Path(__file__).parent/'fixtures/mlb-player-page1.json').read_text())
        self.body['statsTable']=self.body['statsTable'][:1]
        self.body['paginatedResultSet'].update(totalNumPages=1,totalNumResults=1)
        self.calls=[]

    def get(self,method,lid):
        return {'leagueHistoryId':'ml3fdlq2mulovxoh','seasonYear':2026 if lid==self.old else 2027}

    def request(self,lid,method,data):
        self.calls.append((lid,method))
        if method=='getStandings':return {'fantasyTeamInfo':{'t1':{'name':'Doug'}}}
        if method=='getTeamRosterInfo':return {'tables':[{'rows':[]}]}
        return copy.deepcopy(self.body)

    def test_only_new_league_pool_and_complete_reusable_capture(self):
        c=capture(self.get,self.request,'MLB',self.candidate,{'owners':[{'name':'Doug','slug':'doug'}]},lambda _:None)
        self.assertTrue(c['capture_checks_passed'])
        self.assertTrue(all(lid==self.new for lid,_ in self.calls))
        self.assertEqual(c['rosters'],[{'owner':'doug','players':[]}])
        self.assertEqual(len(c['players']),1)

    def test_missing_member_blocks_before_pool(self):
        with self.assertRaisesRegex(ValueError,'membership'):
            capture(self.get,self.request,'MLB',self.candidate,{'owners':[{'name':'Doug','slug':'doug'},{'name':'John','slug':'john'}]},lambda _:None)
        self.assertFalse(any(m=='getPlayerStats' for _,m in self.calls))

if __name__=='__main__':unittest.main()
