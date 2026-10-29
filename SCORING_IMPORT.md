# Manual historical scoring import

This phase connects the shared verified diagnostics to the private scoring ledger.
Only the test Supabase project is permitted. Every imported season is `is_test`
with no championship year. No production standings, schedules or website data
are changed. Existing production seasons cannot be converted to test seasons.

## Run offline tests first

After transferring the reviewed code to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
git pull --ff-only origin main
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:scoring-import
```

The test uses Python 3 (`PYTHON` may override the executable) to normalize the
five actual captured fixtures, then imports into an isolated in-memory database.
Import timestamps, corrections and roster-count fixtures are synthetic test
inputs, not claims of additional Fantrax captures. No hosted service is contacted.

## Capture and preview historical examples

Use the existing test-project URI and CA settings; no migration is added by this
phase. Keep `FANTRAX_COOKIE` private in the terminal. `DRAFT_TEST_CONFIRM` must be
`tgvuntuhdqucazpoxrrg`; `DRAFT_TEST_DATABASE_URL` must be the test-project URI.

```bash
cd /workspaces/MultiSportFantasy2
mkdir -p /workspaces/scoring-evidence
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"

for sport in NFL MLB NBA EPL PGA; do
  python scripts/diagnose_scoring.py --sport "$sport" --live \
    > "/workspaces/scoring-evidence/$sport-diagnostic.tmp.json" || break
  mv "/workspaces/scoring-evidence/$sport-diagnostic.tmp.json" \
    "/workspaces/scoring-evidence/$sport-diagnostic.json"
  extra=()
  if [ "$sport" = PGA ]; then extra=(--tournament-start 2026-06-11); fi
  python scripts/prepare_scoring_import.py \
    --diagnostic "/workspaces/scoring-evidence/$sport-diagnostic.json" \
    --output "/workspaces/scoring-evidence/$sport-import.json" \
    --season-year 2026 --reason "Historical diagnostic validation only" \
    "${extra[@]}" || break
  node supabase/tests/import-scoring.mjs --preview \
    "/workspaces/scoring-evidence/$sport-import.json" \
    > "/workspaces/scoring-evidence/$sport-preview.tmp.json" || break
  mv "/workspaces/scoring-evidence/$sport-preview.tmp.json" \
    "/workspaces/scoring-evidence/$sport-preview.json"
  cat "/workspaces/scoring-evidence/$sport-preview.json"
done
```

These are the diagnostic's verified historical targets, NOT current approved
season connections: Doug MLB September 24; Ryan NFL October 25; Hatch NBA October
23; Doug EPL October 25; Brendan PGA period 21, all 2026. The Canadian Open label
confirms Thursday June 11; no tournament dates are inferred from a period number.

Preview performs the database validations in a transaction and rolls it back.
Confirm the owner, league, dates, totals, missing-record count, revision and
`is_test: true` / `championship_year: null`. Missing roster checks or unknown
starter scores correctly produce pending outcomes. PGA finalization follows the
ledger deadline policy; no new Fantrax final-status field is invented.

Stop on any failure. Envelope creation refuses to overwrite an existing file.
Keep each capture immutable for retries. Older diagnostics without `observed_at`
require the actual capture timestamp via `--observed-at`; never substitute the
time a saved response was normalized. New live diagnostics record acquisition time.

## Apply a reviewed example

For MLB, after reviewing its preview:

```bash
cd /workspaces/MultiSportFantasy2
APPROVAL=$(python -c 'import json; print(json.load(open("/workspaces/scoring-evidence/MLB-preview.json"))["plan_hash"])')
node supabase/tests/import-scoring.mjs --import \
  /workspaces/scoring-evidence/MLB-import.json "$APPROVAL"
```

Repeat with each sport's filenames. Rerunning this exact command must report
`already_imported: true` with the same revision. After a lost connection, retry
the identical envelope and approval; don't create a new capture to resolve an
uncertain commit. Request IDs are deterministic, payloads are validated, and the
SQL revision guard prevents concurrent corrections from overwriting each other.

For a real correction, take a new diagnostic into a new filename, prepare a new
envelope with `--expected-revision` equal to the last imported revision and an
explicit correction reason, preview, then apply its new hash. Its observation
must be later. Previous results remain immutable. An exact retry of an older
capture remains harmless and reports `superseded` after a correction.

## Historical roster checks

`import-scoring-rosters.mjs --preview FILE` and `--import FILE APPROVAL_HASH`
use the same guarded connection. The input envelope is:

```json
{
  "version": 1,
  "is_test": true,
  "check_date": "2026-10-24",
  "expected_revision": 0,
  "reason": "Import preserved historical 4 a.m. snapshots",
  "snapshots": {"NFL": {}, "MLB": {}, "NBA": {}, "EPL": {}, "PGA": {}}
}
```

Replace each empty object with the **entire original** saved roster JSON for
that sport/date. The example is not valid input until actual snapshots are added.
All five must cover the same owners, with matching counts, unique player IDs and
actual observation timestamps in the 4 a.m. Eastern hour. IR/minors count because
all snapshot players count. Source checksums are retained with the evidence.
This test-only helper refuses dates after 2026. It does not modify trade rosters.

The batch previews/commits atomically, retries safely, and requires explicit
expected revisions for corrections. It never reconstructs historical counts
from today's rosters. Without historical files, leave those outcomes pending.

## Remaining rollout gates

Manual hosted imports have NOT been executed by the agent. Validate the previews,
imports and retries above before scheduling anything. Production ingestion still
needs approved league/team coverage for every owner, verified period discovery
for PGA, and a policy for late/missing roster jobs. Current diagnostic profiles
are deliberately fixed historical targets; scheduling them as production would
be incorrect.

After those gates, connect scheduled fresh roster/check storage, all-owner scoring
capture and a read-only website scoring view. The website must separate Cup years,
exclude test seasons, show pending eligibility explicitly, and sum only latest
revisions. That wiring is not enabled in this phase; production standings remain
untouched. No historical check, finality flag or missing score should be invented
to make the next stage appear complete.
