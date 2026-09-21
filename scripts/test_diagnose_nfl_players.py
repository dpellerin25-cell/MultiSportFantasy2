"""Offline diagnostic tests; no Fantrax calls or real credentials."""
import unittest
from unittest.mock import Mock, patch

import diagnose_nfl_players as diagnostic


class DiagnosticTests(unittest.TestCase):
    def test_read_request_and_raw_response(self):
        session = Mock()
        session.post.return_value.status_code = 200
        raw = {"responses": [{"data": {"statsTable": [], "extra": "preserved"}}]}
        session.post.return_value.json.return_value = raw
        self.assertIs(diagnostic.fetch_page(session, 2), raw)
        session.post.assert_called_once_with(
            diagnostic.URL, params={"leagueId": "yg0olhfrmtj45dd6"},
            json={"msgs": [{"method": "getPlayerStats", "data": {
                "statusOrTeamFilter": "ALL_AVAILABLE", "pageNumber": "2",
            }}]}, timeout=30, allow_redirects=False,
        )

    def test_invalid_pages(self):
        for page in [0, -1, True, "1"]:
            with self.assertRaises(ValueError):
                diagnostic.build_payload(page)

    def test_redirect_rejected(self):
        session = Mock()
        session.post.return_value.status_code = 302
        with self.assertRaises(RuntimeError):
            diagnostic.fetch_page(session)
        session.post.return_value.json.assert_not_called()

    def test_http_failure_not_parsed(self):
        session = Mock()
        session.post.return_value.status_code = 403
        session.post.return_value.raise_for_status.side_effect = RuntimeError("HTTP error")
        with self.assertRaises(RuntimeError):
            diagnostic.fetch_page(session)
        session.post.return_value.json.assert_not_called()

    def test_bad_envelopes(self):
        for data in [None, {}, {"error": "login"}, {"responses": []},
                     {"responses": [{"error": "login"}]},
                     {"responses": [{"data": {"error": "login"}}]}]:
            with self.assertRaises(ValueError):
                diagnostic.validate_envelope(data)

    def test_valid_envelope(self):
        diagnostic.validate_envelope({"responses": [{"data": {"statsTable": []}}]})

    @patch.dict("os.environ", {}, clear=True)
    @patch("sys.stderr")
    def test_missing_cookie_stops_before_dependency_or_network(self, stderr):
        self.assertEqual(diagnostic.main([]), 1)


if __name__ == "__main__":
    unittest.main()
