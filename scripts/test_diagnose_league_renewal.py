import unittest
from unittest.mock import Mock
from diagnose_league_renewal import OLD, NEW, BASE, inspect, summarize

class RenewalTests(unittest.TestCase):
    def test_only_evidenced_read_requests(self):
        session = Mock()
        response = Mock(status_code=200)
        response.json.return_value = {'leagueId': NEW, 'season': 2027}
        session.get.return_value = response
        report = inspect(session, 'private-key')
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(session.get.call_args_list[0].args, (BASE+'getLeagues',))
        self.assertEqual(session.get.call_args_list[0].kwargs['params'], {'userSecretId':'private-key'})
        for call in session.get.call_args_list:
            self.assertFalse(call.kwargs['allow_redirects'])
            self.assertEqual(call.kwargs['timeout'], 30)
        session.post.assert_not_called()
        self.assertFalse(report['automatic_switch_performed'])

    def test_metadata_is_not_inferred_relationship(self):
        report = summarize({'leagues':[{'leagueId':OLD,'season':2026},{'leagueId':NEW,'season':2027}]},'private-key')
        self.assertEqual(report['known_ids_observed'], sorted([OLD,NEW]))
        self.assertFalse(report['renewal_relationship_verified'])

    def test_credentials_and_personal_fields_not_printed(self):
        report = summarize({'userSecretId':'private-key','email':'person@example.com','leagueName':'private-key','leagueUrl':'https://example.com/private-key','leagueOwner':'person@example.com'},'private-key')
        self.assertNotIn('private-key', str(report))
        self.assertNotIn('person@example.com', str(report))

    def test_errors_and_redirects_are_redacted(self):
        session = Mock()
        session.get.side_effect = [Exception('URL?userSecretId=private-key'), Mock(status_code=302), Mock(status_code=401)]
        report = inspect(session, 'private-key')
        self.assertTrue(all('error' in r for r in report['results']))
        self.assertNotIn('private-key', str(report))

    def test_output_is_bounded(self):
        report = summarize({'leagues':[{'leagueId':str(i)} for i in range(350)]},'private-key')
        self.assertEqual(len(report['metadata_fields']),300)
        self.assertTrue(report['metadata_truncated'])

if __name__ == '__main__':
    unittest.main()
