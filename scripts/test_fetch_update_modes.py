import contextlib
import io
import unittest
from unittest.mock import patch, mock_open
import fetch_fantrax as fetch


class UpdateModesTest(unittest.TestCase):
    def test_unexpected_roster_response_is_not_an_empty_roster(self):
        for data in ({}, {"tables": []}, {"tables": [{}]}, {"tables": "bad"}):
            with self.assertRaises(ValueError):
                fetch.parse_roster(data)
        self.assertEqual(fetch.parse_roster({"tables": [{"rows": []}]}), [])
        self.assertEqual(fetch.parse_roster({"tables": [{"rows": [{"scorer": None}]}]}), [])

    def run_mode(self, mode):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', return_value={}), patch.object(fetch, 'save_league_json') as standings, patch.object(fetch, 'fetch_all_rosters', return_value=[]) as read_rosters, patch.object(fetch, 'save_roster_json') as rosters, contextlib.redirect_stdout(io.StringIO()):
            fetch.main(['--only', mode])
            return standings.call_count, read_rosters.call_count, rosters.call_count

    def test_daily_rosters_never_save_standings(self):
        self.assertEqual(self.run_mode('rosters'), (0, 5, 5))

    def test_roster_reads_record_start_before_fetch(self):
        from datetime import datetime
        calls = []
        def roster_read(*args):
            calls.append(datetime.now(fetch.timezone.utc))
            return []
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', return_value={}), patch.object(fetch, 'fetch_all_rosters', side_effect=roster_read), patch.object(fetch, 'save_roster_json') as save, contextlib.redirect_stdout(io.StringIO()):
            fetch.main(['--only', 'rosters'])
            self.assertEqual(len(calls), 5)
            for observed, call in zip(calls, save.call_args_list):
                self.assertLessEqual(datetime.fromisoformat(call.args[4]), observed)

    def test_weekly_standings_never_fetch_or_save_rosters(self):
        self.assertEqual(self.run_mode('standings'), (5, 0, 0))

    def test_existing_combined_mode(self):
        self.assertEqual(self.run_mode('all'), (5, 5, 5))

    def test_exact_membership_and_points_required(self):
        import json
        for count in (8, 10):
            names = [f"Owner {i}" for i in range(count)]
            settings = {"owners": [{"name": name} for name in names], "placement_points": list(range(count, 0, -1))}
            with patch("builtins.open", mock_open(read_data=json.dumps(settings))):
                self.assertEqual(fetch.league_settings(names), settings)
                with self.assertRaises(ValueError):
                    fetch.league_settings(names[:-1])
                with self.assertRaises(ValueError):
                    fetch.league_settings(names[:-1] + [names[0]])
            settings["placement_points"] = [0]
            with patch("builtins.open", mock_open(read_data=json.dumps(settings))):
                with self.assertRaises(ValueError):
                    fetch.league_settings(names)

    def test_john_expansion_configuration(self):
        import json
        from pathlib import Path
        settings = json.loads(Path("web/data/league-settings.json").read_text(encoding="utf-8"))
        names = [owner["name"] for owner in settings["owners"]]
        self.assertIn("John", names)
        self.assertEqual(len(names), 10)
        self.assertEqual(fetch.league_settings(names)["placement_points"], [100,82,68,56,45,35,26,18,10,0])
        with self.assertRaisesRegex(ValueError, "Missing:.*John"):
            fetch.league_settings([name for name in names if name != "John"])

    def test_failed_fetch_fails_job_before_commit(self):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', side_effect=RuntimeError('offline')), patch.object(fetch, 'save_league_json') as save, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                fetch.main(['--only', 'standings'])
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
