import argparse
import json
import os
import shutil
from datetime import datetime, timezone


SPORT_FILES = {
    "NFL": "nfl.json",
    "MLB": "mlb.json",
    "NBA": "nba.json",
    "Premier League": "premier-league.json",
    "PGA": "pga.json",
}


def archive_sport(year, sport, force=False):

    if sport not in SPORT_FILES:
        raise RuntimeError(
            f"Unknown sport: {sport}"
        )

    filename = SPORT_FILES[sport]

    source = os.path.join(
        "web",
        "data",
        filename
    )

    destination_directory = os.path.join(
        "web",
        "data",
        "history",
        str(year)
    )

    destination = os.path.join(
        destination_directory,
        filename
    )

    if not os.path.exists(source):
        raise RuntimeError(
            f"Live data file does not exist: {source}"
        )

    os.makedirs(
        destination_directory,
        exist_ok=True
    )

    if os.path.exists(destination) and not force:
        raise RuntimeError(
            f"{destination} already exists. "
            "Historical results are protected from being overwritten. "
            "Use --force only if you intentionally want to replace it."
        )

    shutil.copy2(
        source,
        destination
    )

    metadata_path = os.path.join(
        destination_directory,
        "archive-metadata.json"
    )

    if os.path.exists(metadata_path):
        with open(
            metadata_path,
            "r",
            encoding="utf-8"
        ) as file:
            metadata = json.load(file)
    else:
        metadata = {
            "year": year,
            "sports": {}
        }

    metadata["sports"][sport] = {
        "filename": filename,
        "archived_at": datetime.now(
            timezone.utc
        ).isoformat()
    }

    with open(
        metadata_path,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            metadata,
            file,
            indent=2,
            ensure_ascii=False
        )

    print()
    print("=" * 60)
    print("SPORT ARCHIVED")
    print("=" * 60)
    print(f"Championship year: {year}")
    print(f"Sport: {sport}")
    print(f"Source: {source}")
    print(f"Archive: {destination}")
    print()
    print(
        "This historical result will not be changed "
        "by the normal Fantrax updater."
    )


def main():

    parser = argparse.ArgumentParser(
        description=(
            "Archive a completed sport for a "
            "multisport championship."
        )
    )

    parser.add_argument(
        "year",
        type=int,
        help="Multisport championship year"
    )

    parser.add_argument(
        "sport",
        choices=SPORT_FILES.keys(),
        help="Sport to archive"
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace an existing historical snapshot"
    )

    args = parser.parse_args()

    archive_sport(
        args.year,
        args.sport,
        args.force
    )


if __name__ == "__main__":
    main()
