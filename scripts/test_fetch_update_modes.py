import contextlib
import io
import unittest
from unittest.mock import patch, mock_open
import fetch_fantrax as fetch


class UpdateModesTest(unittest.TestCase):
    def test_prelaunch_skips_standings_but_continues_rosters(self):
        from championship_calendar import PrelaunchSeason
        def save(sport, *args):
            if sport != 'MLB':
                raise PrelaunchSeason('Pre-launch season is not a Pentagon Cup championship')
        for mode in ('standings', 'all'):
            output = io.StringIO()
            with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', return_value={}), patch.object(fetch, 'save_league_json', side_effect=save) as standings, patch.object(fetch, 'fetch_all_rosters', return_value=[]), patch.object(fetch, 'save_roster_json') as rosters, contextlib.redirect_stdout(output):
                fetch.main(['--only', mode])
            self.assertEqual(standings.call_count, 5)
            self.assertEqual(rosters.call_count, 5 if mode == 'all' else 0)
            self.assertIn('Pre-launch standings skipped: 4', output.getvalue())
            self.assertIn('Failed: 0', output.getvalue())

    def test_prelaunch_writes_nothing_and_missing_year_is_error(self):
        from championship_calendar import PrelaunchSeason
        connection = {'current_league_id': 'test', 'current_season_year': 2026}
        with patch.object(fetch, 'CONNECTIONS', {'sports': {'NFL': connection}}), patch('builtins.open') as write:
            with self.assertRaises(PrelaunchSeason):
                fetch.save_league_json('NFL', 'test', 'nfl.json', {})
            write.assert_not_called()
            del connection['current_season_year']
            with self.assertRaisesRegex(ValueError, 'Integer Fantrax'):
                fetch.save_league_json('NFL', 'test', 'nfl.json', {})
            write.assert_not_called()

    def test_other_validation_errors_still_fail(self):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', return_value={}), patch.object(fetch, 'save_league_json', side_effect=ValueError('Invalid membership')), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, '5 league'):
                fetch.main(['--only', 'standings'])

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

    def test_billy_expansion_configuration(self):
        import json
        from pathlib import Path
        settings = json.loads(Path("web/data/league-settings.json").read_text(encoding="utf-8"))
        names = [owner["name"] for owner in settings["owners"]]
        self.assertIn("John", names)
        self.assertIn("Billy", names)
        with self.assertRaisesRegex(ValueError, "Missing:.*Billy"):
            fetch.league_settings([name for name in names if name != "Billy"])
        self.assertEqual(len(names), 11)
        self.assertEqual(fetch.league_settings(names)["placement_points"], [100,83,70,59,49,40,32,24,16,8,0])
        with self.assertRaisesRegex(ValueError, "Missing:.*John"):
            fetch.league_settings([name for name in names if name != "John"])

    def test_optional_john_is_standings_only(self):
        import json
        from pathlib import Path
        names = [o["name"] for o in json.loads(Path("web/data/league-settings.json").read_text())["owners"]]
        without_john = [n for n in names if n != "John"]
        self.assertEqual(len(fetch.league_settings(without_john, allow_missing_john=True)["placement_points"]), 11)
        with self.assertRaises(ValueError):
            fetch.league_settings(without_john)
        for invalid in ([n for n in without_john if n != "Doug"], without_john + ["Unknown"], without_john + [without_john[0]], []):
            with self.assertRaises(ValueError):
                fetch.league_settings(invalid, allow_missing_john=True)

    def test_failed_fetch_fails_job_before_commit(self):
        with patch.object(fetch, 'create_session'), patch.object(fetch, 'fetch_league', side_effect=RuntimeError('offline')), patch.object(fetch, 'save_league_json') as save, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                fetch.main(['--only', 'standings'])
            save.assert_not_called()


if __name__ == '__main__':
    unittest.main()
