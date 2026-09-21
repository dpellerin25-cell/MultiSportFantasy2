import copy
import json
from pathlib import Path
import unittest
from nfl_player_pool import collect_pool, normalize

LEAGUE = "yg0olhfrmtj45dd6"
FIXTURES = Path(__file__).parent / "fixtures"

class PoolTests(unittest.TestCase):
    def setUp(self):
        self.pages = [json.loads((FIXTURES / f"nfl-player-page{n}.json").read_text()) for n in (1, 2)]

    def run_pool(self, pages=None, **kwargs):
        pages = pages or self.pages
        return collect_pool(lambda n: pages[n-1], LEAGUE, set(), **kwargs)

    def small_pool(self):
        for p in self.pages:
            p["paginatedResultSet"].update(totalNumPages=2, totalNumResults=40)

    def test_real_captures_normalize(self):
        rows = [normalize(r, p["tableHeader"]["cells"], LEAGUE) for p in self.pages for r in p["statsTable"]]
        self.assertEqual(len({r["player_id"] for r in rows}), 40)
        self.assertIn("free_agent", {r["availability_status"] for r in rows})
        self.assertIn("waivers", {r["availability_status"] for r in rows})
        self.assertNotIn("04mnz", {r["player_id"] for r in rows})

    def test_pagination_termination(self):
        self.small_pool()
        result = self.run_pool()["summary"]
        self.assertTrue(result["complete"])
        self.assertEqual(result["pages_retrieved"], 2)
        self.assertEqual(result["unique_available_players"], 40)

    def test_partial_last_page(self):
        self.small_pool()
        for p in self.pages: p["paginatedResultSet"]["totalNumResults"] = 23
        self.pages[1]["statsTable"] = self.pages[1]["statsTable"][:3]
        self.assertEqual(self.run_pool()["summary"]["unique_available_players"], 23)

    def test_duplicates_flag_incomplete(self):
        self.small_pool()
        self.pages[1]["statsTable"][0] = copy.deepcopy(self.pages[0]["statsTable"][0])
        summary = self.run_pool()["summary"]
        self.assertFalse(summary["complete"])
        self.assertEqual(summary["duplicate_records_removed"], 1)

    def test_errors(self):
        mutations = [
            lambda: self.pages[1]["paginatedResultSet"].update(pageNumber=1),
            lambda: self.pages[1]["paginatedResultSet"].update(totalNumResults=39),
            lambda: self.pages[1].update(statsTable=[]),
            lambda: self.pages[1].update(statsTable=copy.deepcopy(self.pages[0]["statsTable"])),
            lambda: self.pages[0].update(displayedStatusOrTeam="ALL"),
            lambda: self.pages[0].update(paginatedResultSet={}),
        ]
        for mutate in mutations:
            self.setUp(); self.small_pool(); mutate()
            with self.assertRaises(ValueError): self.run_pool()

    def test_safety_limit(self):
        with self.assertRaises(ValueError): self.run_pool(max_pages=1)

    def test_rostered_player_rejected(self):
        self.small_pool()
        pid = self.pages[0]["statsTable"][0]["scorer"]["scorerId"]
        with self.assertRaises(ValueError):
            collect_pool(lambda n:self.pages[n-1], LEAGUE, {pid})

    def test_unknown_status_and_missing_team(self):
        row = copy.deepcopy(self.pages[0]["statsTable"][0])
        row["cells"][1] = {"content":"FA"}
        row["scorer"]["teamShortName"] = ""
        result = normalize(row, self.pages[0]["tableHeader"]["cells"], LEAGUE)
        self.assertEqual(result["availability_status"], "unknown")
        self.assertIsNone(result["professional_team"])

    def test_empty(self):
        p = self.pages[0]
        p["paginatedResultSet"].update(totalNumPages=0,totalNumResults=0)
        p["statsTable"] = []
        self.assertTrue(self.run_pool()["summary"]["complete"])

if __name__ == "__main__": unittest.main()
