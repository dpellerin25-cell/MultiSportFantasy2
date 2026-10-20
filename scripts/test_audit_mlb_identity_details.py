import unittest
from audit_mlb_identity_details import review,metadata_evidence,OLD,NEW


class IdentityReviewTests(unittest.TestCase):
    def row(self,pid,name,new):
        return {'player_id':pid,'stored_records':[{'name':name,'sport':'MLB','active_selections':0,'source':'draft'}],'captured_name':new}

    def test_formatting_is_candidate_only_and_cross_id_collision(self):
        report={'sport':'MLB','old_league_id':OLD,'new_league_id':NEW,
                'missing_player_details':[self.row('074vs','Luke Pelzer',None)],
                'identity_difference_details':[self.row('06zar','Luke Nowak','Luke Pelzer'),self.row('06kx4','A.J. Gracia','AJ Gracia'),self.row('066f2','John Lynch','Jack Lynch')]}
        rows=review(report)
        self.assertEqual(rows[0]['classification'],'absent_from_capture')
        self.assertEqual(rows[1]['other_stored_ids_with_captured_name'],['074vs'])
        self.assertEqual(rows[1]['classification'],'cross_id_name_collision')
        self.assertEqual(rows[2]['classification'],'formatting_only_candidate')
        self.assertEqual(rows[3]['classification'],'name_change_requires_verification')
        report['new_league_id']=OLD
        with self.assertRaises(ValueError):review(report)

    def test_metadata_shapes_fields_and_bounds(self):
        raw={'playerInfo':{'abc':{'name':'Player','email':'SECRET','cookie':'SECRET'},'rows':[{'scorerId':'def','name':'Other','token':'SECRET'}]},'secret':'SECRET'}
        result=metadata_evidence(raw,{'abc','def'})
        self.assertEqual(result['matches']['abc'],[{'name':'Player'}])
        self.assertEqual(result['matches']['def'],[{'scorerId':'def','name':'Other'}])
        self.assertNotIn('SECRET',str(result))
        self.assertFalse(metadata_evidence({}, {'abc'})['player_info_present'])
        value={}
        for _ in range(22):value={'nested':value}
        with self.assertRaises(ValueError):metadata_evidence({'playerInfo':value},{'abc'})


if __name__=='__main__':unittest.main()
