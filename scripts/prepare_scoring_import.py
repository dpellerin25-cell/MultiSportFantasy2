"""Wrap a shared diagnostic as explicit historical TEST import evidence."""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--diagnostic', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--season-year', type=int, required=True)
    p.add_argument('--observed-at', help='Actual capture timestamp; required for older/saved diagnostics without one')
    p.add_argument('--tournament-start', help='Verified PGA Thursday, YYYY-MM-DD')
    p.add_argument('--expected-revision', type=int, default=0)
    p.add_argument('--reason', required=True)
    a = p.parse_args()
    d = json.loads(a.diagnostic.read_text(encoding='utf-8-sig'))
    observed = a.observed_at or d.get('observed_at')
    if not observed:
        p.error('Supply the actual --observed-at capture time; do not invent one for saved evidence.')
    if d.get('historical_test_data') is not True or d.get('production_ready') is not False:
        p.error('Only the shared historical diagnostic is accepted.')
    e = dict(version=1, is_test=True, season_year=a.season_year, observed_at=observed,
             expected_revision=a.expected_revision, reason=a.reason, diagnostic=d)
    if a.tournament_start:
        e['tournament_start'] = a.tournament_start
    # Never overwrite the immutable capture used for an earlier import/retry.
    with a.output.open('x', encoding='utf-8') as f:
        json.dump(e, f, indent=2, allow_nan=False)
    print('Created test envelope. Database preview is still required.')


if __name__ == '__main__':
    main()
