import copy
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from archive_renewed_sports import archive_capture, validate_preview


class RenewalArchives(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.capture = {'sport': 'MLB', 'old_league_id': 'old', 'new_league_id': 'new',
                        'old_season_year': 2027, 'capture_checks_passed': True,
                        'started_at': datetime.now(timezone.utc).isoformat()}
        self.registry = {'championship_year': 2027, 'sports': {'MLB': {'current_league_id': 'old'}}}
        self.settings = {'championship_year': 2027, 'owners': [{'name': 'Doug'}, {'name': 'Chris'}],
                         'placement_points': [100, 0]}
        self.rows = [{'team': name, 'team_id': str(i), 'rank': str(i), 'fantasyPoints': str(10-i)}
                     for i, name in enumerate(['Doug', 'Chris'], 1)]

    def run_archive(self, rows=None):
        return archive_capture(self.capture, self.registry, self.settings,
                               lambda _: copy.deepcopy(self.rows if rows is None else rows), self.root)

    def test_fresh_single_sport_archive_and_immutable_retry(self):
        self.assertFalse(self.run_archive()['already_archived'])
        path = self.root/'2027/mlb.json'
        original = path.read_bytes()
        saved = json.loads(original)
        self.assertEqual(saved['league_id'], 'old')
        self.assertEqual(saved['placement_points'], [100, 0])
        self.assertEqual(saved['standings'], self.rows)
        self.assertEqual(list(json.loads((path.parent/'archive-metadata.json').read_text())['sports']), ['MLB'])
        self.assertTrue(self.run_archive([])['already_archived'])
        self.assertEqual(path.read_bytes(), original)

    def test_bad_data_does_not_write(self):
        cases = [[], self.rows[:1], [self.rows[0], self.rows[0]],
                 [dict(self.rows[0], fantasyPoints='NaN'), self.rows[1]],
                 [dict(self.rows[0], rank='0'), self.rows[1]]]
        for rows in cases:
            with self.assertRaises((ValueError, KeyError)):
                self.run_archive(rows)
            self.assertFalse((self.root/'2027/mlb.json').exists())

    def test_prelaunch_pending_release_and_stale_capture_block(self):
        for field, value in [('old_season_year', 2026), ('capture_checks_passed', False),
                             ('started_at', '2020-01-01T00:00:00+00:00')]:
            original = self.capture[field]
            self.capture[field] = value
            with self.assertRaises(ValueError): self.run_archive()
            self.capture[field] = original
        self.registry['sports']['MLB']['standings_league_id'] = 'previous'
        with self.assertRaises(ValueError): self.run_archive()

    def test_conflicting_archive_not_overwritten(self):
        self.run_archive()
        path = self.root/'2027/mlb.json'
        value = json.loads(path.read_text()); value['league_id'] = 'other'
        path.write_text(json.dumps(value))
        original = path.read_bytes()
        with self.assertRaises(ValueError): self.run_archive()
        self.assertEqual(path.read_bytes(), original)

    def test_blocked_or_mismatched_preview_rejected(self):
        preview = {**self.capture, 'blockers': []}
        validate_preview(preview, self.capture)
        for change in [{'blockers': ['membership differs']}, {'new_league_id': 'other'}, {'sport': 'NFL'}]:
            with self.assertRaises(ValueError): validate_preview({**preview, **change}, self.capture)

    def test_cross_year_sports_archive_into_championship_year(self):
        for sport in ['NFL', 'NBA', 'EPL']:
            self.capture.update(sport=sport, old_season_year=2026)
            self.registry['sports'][sport] = {'current_league_id': 'old'}
            self.assertEqual(self.run_archive()['year'], 2027)


if __name__ == '__main__': unittest.main()
