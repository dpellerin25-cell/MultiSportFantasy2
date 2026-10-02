import contextlib
import io
import unittest
from unittest.mock import patch, mock_open
import fetch_fantrax as fetch


class UpdateModesTest(unittest.TestCase):
    def run_mode(self, mode):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', return_value={}), patch.object(fetch, 'save_league_json') as standings, patch.object(fetch, 'fetch_all_rosters', return_value=[]) as read_rosters, patch.object(fetch, 'save_roster_json') as rosters, contextlib.redirect_stdout(io.StringIO()):
            fetch.main(['--only', mode])
            return standings.call_count, read_rosters.call_count, rosters.call_count

    def test_daily_rosters_never_save_standings(self):
        self.assertEqual(self.run_mode('rosters'), (0, 5, 5))

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

    def test_failed_fetch_fails_job_before_commit(self):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', side_effect=RuntimeError('offline')), patch.object(fetch, 'save_league_json') as save, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                fetch.main(['--only', 'standings'])
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
