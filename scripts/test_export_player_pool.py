import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import export_player_pool as exporter


class ExportTests(unittest.TestCase):
    def test_five_real_shapes_export_all_rows(self):
        fixtures = Path(__file__).parent / "fixtures"
        bodies = {}
        for sport in ["NFL", *exporter.LEAGUES]:
            body = json.loads((fixtures / (sport.lower()+"-player-page1.json")).read_text())
            body["paginatedResultSet"].update(totalNumResults=20,totalNumPages=1)
            bodies[sport] = body
        session = Mock()
        session.post.return_value.status_code = 200
        leagues = {"NFL": exporter.NFL_LEAGUE_ID, **exporter.LEAGUES}
        def response():
            league = session.post.call_args.kwargs["params"]["leagueId"]
            sport = next(s for s, l in leagues.items() if l == league)
            return {"responses": [{"data": bodies[sport]}]}
        session.post.return_value.json.side_effect = response
        def roster_read(path, *args, **kwargs):
            sport = next(s for s in leagues if path.name == ("nfl.json" if s == "NFL" else exporter.ROSTERS[s]+".json"))
            return json.dumps({"league_id":leagues[sport],"rosters":[],"updated_at":"fixture"})
        with patch.object(Path,"read_text",roster_read):
            result = exporter.export_data(session)
        self.assertEqual(result["total_players"],100)
        self.assertEqual(len(result["players"]),100)
        self.assertEqual(len(result["sports"]),5)
        self.assertTrue(result["complete"])
        self.assertTrue(all(len([p for p in result["players"] if p["sport"]==s])==20 for s in leagues))
        self.assertEqual(session.post.call_count,5)

    def test_write_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"pool.json"
            exporter.write_export(path,{"players":[{"player_id":"test"}]})
            original=path.read_bytes()
            with self.assertRaises(ValueError):exporter.write_export(path,{})
            self.assertEqual(path.read_bytes(),original)
            self.assertEqual(len(list(Path(directory).iterdir())),1)

    def test_failed_serialization_leaves_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"pool.json"
            with self.assertRaises(TypeError):exporter.write_export(path,{"bad":object()})
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_production_output_rejected(self):
        with self.assertRaises(ValueError):exporter.write_export(exporter.ROOT/"web/data/test-pool.json",{})

    @patch.dict("os.environ",{},clear=True)
    @patch("sys.stderr")
    def test_missing_cookie_does_not_write(self, stderr):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/"pool.json"
            self.assertEqual(exporter.main(["--output",str(path)]),1)
            self.assertFalse(path.exists())

    @patch.object(exporter,"collect_pool")
    def test_incomplete_pool_rejected(self, collect):
        collect.return_value={"summary":{"complete":False}}
        roster={"league_id":exporter.NFL_LEAGUE_ID,"rosters":[]}
        with patch.object(Path,"read_text",return_value=json.dumps(roster)):
            with self.assertRaisesRegex(ValueError,"incomplete"):
                exporter.export_data(Mock())


if __name__ == "__main__":unittest.main()
