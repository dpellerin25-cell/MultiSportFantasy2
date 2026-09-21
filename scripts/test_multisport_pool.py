import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import diagnose_sport_players as diagnostic
from nfl_player_pool import collect_pool, normalize


class MultiSportTests(unittest.TestCase):
    def fixture(self, sport):
        return json.loads((Path(__file__).parent / "fixtures" / (sport.lower()+"-player-page1.json")).read_text())

    def test_captured_fields(self):
        for sport in diagnostic.LEAGUES:
            body = self.fixture(sport)
            players = [normalize(r, body["tableHeader"]["cells"], diagnostic.LEAGUES[sport], sport) for r in body["statsTable"]]
            self.assertEqual(len(players), 20)
            self.assertTrue(all(p["sport"] == sport and p["availability_status"] == "free_agent" for p in players))
            if sport == "PGA":
                self.assertIsNone(players[0]["position"])
                self.assertIsNone(players[0]["professional_team"])

    def test_each_full_pool_and_last_page(self):
        for sport, position in diagnostic.FILTERS.items():
            body = self.fixture(sport)
            body["paginatedResultSet"].update(totalNumPages=2,totalNumResults=21)
            second = copy.deepcopy(body)
            second["paginatedResultSet"]["pageNumber"] = 2
            second["statsTable"] = copy.deepcopy(body["statsTable"][:1])
            second["statsTable"][0]["scorer"]["scorerId"] = "synthetic-final-player"
            fetch = Mock(side_effect=[body,second])
            result=collect_pool(fetch,diagnostic.LEAGUES[sport],set(),1000,sport=sport,position_filter=position)
            self.assertTrue(result["summary"]["complete"])
            self.assertEqual(result["summary"]["unique_available_players"],21)
            self.assertEqual(fetch.call_count,2)

    def test_mlb_limit_and_missing_second_page(self):
        body=self.fixture("MLB")
        with self.assertRaisesRegex(ValueError,"safety limit"):
            collect_pool(lambda n:body,diagnostic.LEAGUES["MLB"],set(),500,sport="MLB",position_filter="ALL")
        fetch=Mock(side_effect=[body,ValueError("second page requested")])
        with self.assertRaisesRegex(ValueError,"second page requested"):
            collect_pool(fetch,diagnostic.LEAGUES["MLB"],set(),1000,sport="MLB",position_filter="ALL")

    def test_position_and_date_filters_rejected(self):
        for changes in ({"displayedPosOrGroup":"POS_302"},{"displayedSelections":{"searchName":"","displayedMiscDisplayType":"1","datePlaying":"TODAY"}}):
            body=self.fixture("NBA");body.update(changes)
            with self.assertRaises(ValueError):
                collect_pool(lambda n:body,diagnostic.LEAGUES["NBA"],set(),1000,sport="NBA",position_filter="BASKETBALL_PLAYER")

    @patch.object(diagnostic,"inspect_page")
    def test_pga_comparison_only(self, inspect):
        inspect.return_value={"validated":True}
        session=Mock()
        result=diagnostic.check_pga(session)
        self.assertFalse(result["complete_pool"])
        self.assertEqual(inspect.call_args_list[0].args,(session,"PGA",1,"POS_500"))
        self.assertEqual(inspect.call_args_list[1].args,(session,"PGA",1,"GOLF_GOLFER"))

    @patch.object(Path, "read_text")
    def test_pga_full_pool_request_and_normalization(self, read):
        body=json.loads((Path(__file__).parent / "fixtures/pga-player-page1.json").read_bytes())
        body["paginatedResultSet"].update(totalNumPages=1,totalNumResults=20)
        read.return_value=json.dumps({"league_id":diagnostic.LEAGUES["PGA"],"rosters":[],"updated_at":"test"})
        session=Mock();session.post.return_value.status_code=200
        session.post.return_value.json.return_value={"responses":[{"data":body}]}
        result=diagnostic.full_pool(session,"PGA",1000)
        self.assertTrue(result["validated"])
        self.assertEqual(result["sample"][0]["sport"],"PGA")
        self.assertIsNone(result["sample"][0]["position"])
        self.assertIsNone(result["sample"][0]["professional_team"])
        self.assertEqual(session.post.call_args.kwargs["json"]["msgs"][0]["data"]["positionOrGroup"],"GOLF_GOLFER")
        body["displayedPosOrGroup"]="UNEXPECTED"
        with self.assertRaises(ValueError):diagnostic.full_pool(session,"PGA",1000)

    def test_explicit_filter_payload(self):
        session=Mock();session.post.return_value.status_code=200
        session.post.return_value.json.return_value={"responses":[{"data":self.fixture("MLB")}]}
        diagnostic.inspect_page(session,"MLB",1,"ALL")
        self.assertEqual(session.post.call_args.kwargs["json"]["msgs"][0]["data"]["positionOrGroup"],"ALL")

if __name__ == "__main__":unittest.main()
