"""Strict diagnostic parser based on the supplied NFL page 1/2 captures."""
from collections import Counter


def normalize(row, headers, league_id):
    scorer = row.get("scorer", {})
    player_id, name = scorer.get("scorerId"), scorer.get("name")
    if not isinstance(player_id, str) or not player_id or not isinstance(name, str) or not name:
        raise ValueError("Player row is missing a stable ID or name.")
    status = "unknown"
    indices = [i for i, h in enumerate(headers) if h.get("key") == "status"]
    if len(indices) == 1 and indices[0] < len(row.get("cells", [])):
        cell = row["cells"][indices[0]]
        tooltip = cell.get("toolTip", "")
        if tooltip.startswith("Waiver Wire"):
            status = "waivers"
        elif tooltip.strip().casefold() == "free agent" or cell.get("content", "").strip().casefold() == "free agent":
            status = "free_agent"
    return {
        "player_id": player_id, "player_name": name, "sport": "NFL",
        "position": scorer.get("posShortNames") or None,
        "professional_team": scorer.get("teamShortName") or None,
        "availability_status": status, "league_id": league_id,
    }


def collect_pool(fetch, league_id, rostered_ids, max_pages=500):
    if type(max_pages) is not int or max_pages < 1:
        raise ValueError("max_pages must be positive.")
    players, fingerprints = {}, set()
    baseline = None
    raw_count = 0
    for page in range(1, max_pages + 1):
        body = fetch(page)
        if body.get("displayedStatusOrTeam") != "ALL_AVAILABLE" or body.get("displayedPosOrGroup") != "FOOTBALL_OFFENSE":
            raise ValueError("Unexpected availability or position filter.")
        selections = body.get("displayedSelections", {})
        if selections.get("searchName") != "" or selections.get("displayedMiscDisplayType") != "1":
            raise ValueError("Unexpected search or rookie filter.")
        meta = body.get("paginatedResultSet", {})
        values = [meta.get(k) for k in ("pageNumber", "totalNumPages", "totalNumResults", "maxResultsPerPage")]
        if any(type(v) is not int for v in values):
            raise ValueError("Missing or invalid pagination metadata.")
        actual, pages, total, size = values
        if actual != page or total < 0 or size < 1 or pages < 0:
            raise ValueError("Invalid or repeated page number.")
        if pages != (total + size - 1) // size and not (total == 0 and pages == 1):
            raise ValueError("Inconsistent page count and total.")
        if pages > max_pages:
            raise ValueError("Server page count exceeds safety limit; no complete result produced.")
        signature = (pages, total, size)
        if baseline is not None and baseline != signature:
            raise ValueError("Pool totals changed during pagination; rerun.")
        baseline = signature
        rows = body.get("statsTable")
        if not isinstance(rows, list) or len(rows) != min(size, max(0, total - (page - 1) * size)):
            raise ValueError("Short/malformed page; incomplete result.")
        normalized = [normalize(r, body.get("tableHeader", {}).get("cells", []), league_id) for r in rows]
        fingerprint = tuple(sorted(p["player_id"] for p in normalized))
        if rows and fingerprint in fingerprints:
            raise ValueError("Repeated player page; pagination did not advance.")
        fingerprints.add(fingerprint)
        raw_count += len(rows)
        for player in normalized:
            key = player["player_id"]
            if key in rostered_ids:
                raise ValueError(f"Available pool contains roster-snapshot player {key}; verify current roster before proceeding.")
            if key in players and players[key] != player:
                raise ValueError("Conflicting duplicate player; pool changed during retrieval.")
            players[key] = player
        if page >= pages:
            counts = Counter(p["availability_status"] for p in players.values())
            summary = {
                "pages_retrieved": page, "raw_player_records": raw_count,
                "unique_available_players": len(players),
                "duplicate_records_removed": raw_count - len(players),
                "reported_total": total, "complete": len(players) == total,
                "free_agent_count": counts["free_agent"] if not counts["unknown"] else None,
                "waiver_count": counts["waivers"] if not counts["unknown"] else None,
                "identified_free_agents": counts["free_agent"],
                "identified_waiver_players": counts["waivers"],
                "unknown_status_count": counts["unknown"],
                "roster_snapshot_ids_checked": len(rostered_ids),
            }
            return {"summary": summary, "sample": list(players.values())[:5]}
    raise ValueError("Page safety limit reached; incomplete result.")
