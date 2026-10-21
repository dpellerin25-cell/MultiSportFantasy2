import unittest
from unittest.mock import patch
from championship_calendar import CALENDAR, championship_year

class CalendarTests(unittest.TestCase):
    def test_all_five_sports_and_overlapping_calendar(self):
        self.assertEqual(set(CALENDAR['sports']), {'NFL','MLB','NBA','EPL','PGA'})
        for sport, rule in CALENDAR['sports'].items():
            self.assertEqual(rule['spans_calendar_years'], sport in ('NFL','NBA','EPL'))
        self.assertEqual(championship_year('MLB', 2027), 2027)
        self.assertEqual(championship_year('MLB', 2028), 2028)

    def test_no_prelaunch_or_unverified_inference(self):
        with self.assertRaisesRegex(ValueError, 'Pre-launch'): championship_year('MLB', 2026)
        for sport in ['NFL','NBA','EPL','PGA']:
            with self.assertRaisesRegex(ValueError, 'captured date evidence'): championship_year(sport,2027)

    def test_fetch_rejects_prelaunch_before_writing(self):
        import fetch_fantrax as fetch
        with patch.object(fetch, 'CONNECTIONS', {'sports': {'MLB': {'current_league_id':'old', 'current_season_year':2026}}}):
            with self.assertRaisesRegex(ValueError, 'Pre-launch'):
                fetch.save_league_json('MLB','old','mlb.json',{})

if __name__ == '__main__': unittest.main()
