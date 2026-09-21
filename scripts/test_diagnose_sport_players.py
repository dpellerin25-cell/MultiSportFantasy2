import unittest
from unittest.mock import Mock, patch
import diagnose_sport_players as diagnostic


class SportDiagnosticTests(unittest.TestCase):
    def test_each_league_uses_only_verified_read(self):
        for sport, league in diagnostic.LEAGUES.items():
            session = Mock()
            session.post.return_value.status_code = 200
            raw = {"responses": [{"data": {"displayedStatusOrTeam": "ALL_AVAILABLE", "statsTable": []}}]}
            session.post.return_value.json.return_value = raw
            result = diagnostic.inspect_page(session, sport)
            self.assertIs(result["raw_response"], raw)
            self.assertTrue(result["validated"])
            session.post.assert_called_once_with(diagnostic.URL,
                params={"leagueId": league}, json={"msgs": [{"method": "getPlayerStats", "data": {
                    "statusOrTeamFilter": "ALL_AVAILABLE", "pageNumber": "1"}}]},
                timeout=30, allow_redirects=False)

    def test_unexpected_envelope_or_filter_preserved(self):
        for raw in [{"error": "login"}, {"responses": [{"data": {"displayedStatusOrTeam": "ALL", "statsTable": []}}]}]:
            session = Mock()
            session.post.return_value.status_code = 200
            session.post.return_value.json.return_value = raw
            result = diagnostic.inspect_page(session, "MLB")
            self.assertFalse(result["validated"])
            self.assertIs(result["raw_response"], raw)

    def test_redirect_rejected(self):
        session = Mock()
        session.post.return_value.status_code = 302
        with self.assertRaises(RuntimeError): diagnostic.inspect_page(session, "PGA")
        session.post.return_value.json.assert_not_called()

    @patch.dict("os.environ", {}, clear=True)
    @patch("sys.stderr")
    def test_missing_cookie(self, stderr):
        self.assertEqual(diagnostic.main(["--sport", "all"]), 1)


if __name__ == "__main__":
    unittest.main()
