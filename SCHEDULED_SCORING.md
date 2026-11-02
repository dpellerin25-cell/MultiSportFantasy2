# Scheduled player scoring and player totals

## What this adds

`202611010001_scheduled_scoring.sql` adds private approved sources, a persistent per-owner/date or tournament queue, and append-only collection attempts. Existing scoring results, corrections, roster checks, pause history and PGA resolutions are reused. The public `player_scoring_totals` API exposes only explicitly published championship sources, never historical test seasons or private roster evidence. Standings, placement and dominance calculations are not connected to this API.

On a sport page, click an owner's name. Choose the Cup year to see known starter points, removed positive points, counted points and pending periods. Bench points never count. Pending periods are excluded from counted totals rather than presented as finalized zeroes. Traded players remain under the owner/team that earned their historical contributions; current roster membership is not used to assign scores.

## Collection and corrections

- Daily sport jobs start the day after the configured scoring date. PGA periods become due Tuesday at 1 a.m. Eastern, with explicit unfinished events remaining pending.
- The workflow runs at 5:30 a.m., 11:30 a.m., 5:30 p.m. and 11:30 p.m. Eastern, plus Tuesday 1 a.m. GitHub can delay execution; due-time checks prevent early finalization.
- Each run handles at most 200 jobs, oldest unattempted/last-attempted first. All configured dates are retained, so outages leave a backlog rather than silent omissions.
- Completed dates in the most recent 14 days are re-read. Pending/failed jobs continue retrying after six hours, even when older. An older finalized correction can be requested with `--run JOB_UUID`.
- Identical content does not create another scoring revision, even with a later observation time. Changed content appends a revision; older captures cannot overwrite newer results. Attempt records remain as an audit trail.
- Identical raw captures preserve existing manual confirmations. A changed capture over a manually corrected result is held for review instead of erasing the correction. Missing records are never automatically interpreted as non-participation.
- Network, malformed response and import errors create a safe pending reason and fail the workflow for attention. Successfully processed jobs remain committed. Retrying is safe.
- The existing evaluator applies the cap effective at each actual checkpoint (80 currently), positive-only penalties, both PGA checkpoints, pause history and mixed-pause commissioner decisions. Reads re-evaluate evidence so later roster corrections do not leave stale displayed penalties.
- Scoring sources are frozen per league season, independent of the current roster connection. Renewing rosters cannot switch the collector halfway through the prior championship. New seasons need their own approved source.

## Evidence and approval still required

The existing five historical captures prove the request and normalization patterns, not every future league's counted historical lineup behavior. Before approving a championship source, verify its season dates, all owner/team IDs, and a completed day's starting-lineup attribution against Fantrax (including Best Ball if applicable). Set `lineup_attribution_verified` only after that check.

PGA requires verified numeric period IDs and Thursday start dates. The captured response supplies labels but not a sufficiently trustworthy year-qualified schedule for automatic discovery. Do not invent IDs or copy period 21 into a future season. An empty PGA schedule is rejected. Future season IDs cannot be approved until the league exists and its approved runtime connection has the correct season year.

No 2026 test season becomes Cup 2027. Unknown or missing scoring remains pending, and older historical roster snapshots are not fabricated.

## 1. Local/Codespaces validation

Transfer the reviewed changes to Codespaces, then run:

```bash
cd /workspaces/MultiSportFantasy2
PYTHONPATH=scripts python -m unittest test_scheduled_scoring test_diagnose_scoring
cd supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:scheduled-scoring
node scoring.test.mjs
node daily-scoring-checks.test.mjs
node scoring-controls.test.mjs
npx --yes pnpm@11.25.0 test:scheduled-scoring-concurrency
npx --yes pnpm@11.25.0 test:scoring-concurrency
cd ../../web
npm run build
```

The Docker runners require Docker. They contact only a disposable loopback PostgreSQL database, retain synthetic fixtures, and print precise cleanup commands. Offline tests do not prove concurrent sessions or live Fantrax responses. The new concurrency runner checks identical simultaneous captures and a queued stale correction. The existing runner covers roster corrections, pauses and PGA decisions.

## 2. Apply to the test project only

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review the pending migration list. After the tests and review:

```bash
npx supabase db push --linked
```

This implementation does not apply migrations or change hosted settings for you.

## 3. Configure a source using verified metadata

Use the same verified-TLS database configuration as roster sync. Set these privately in your terminal:

- `TRADE_ROSTER_PROJECT_REF=tgvuntuhdqucazpoxrrg`
- `TRADE_ROSTER_DATABASE_URL` (test project's database URI)
- `SCORING_PROJECT_CONFIRM=tgvuntuhdqucazpoxrrg`
- `NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"`
- `FANTRAX_COOKIE` for the live collector, never in Git or browser settings.

Create a template outside the repository:

```bash
node supabase/tests/configure-scoring-source.mjs --template /workspaces/scoring-source.json
code /workspaces/scoring-source.json
```

Replace the template values with verified sport, league ID, season year, scoring start/end dates and every owner/team ID. For an actual championship use `is_test: false`; its season year is its Cup year. For historical diagnostic validation use `is_test: true`; a subset of actual linked owners is permitted and it can never be publicly published. The sample dates in the template are examples, not defaults for other leagues.

For PGA the `periods` array must look like this **using your verified dates/IDs**:

```json
[{"period":21,"start_date":"2026-06-11"}]
```

That example is only the historical 2026 Canadian Open capture. For daily sports use `periods: []`. The source's date range must contain every configured period. Approved source specifications cannot be silently changed; if mappings need correction, disable the source and review an explicit administrative migration rather than editing history.

```bash
node supabase/tests/configure-scoring-source.mjs --preview /workspaces/scoring-source.json
node supabase/tests/configure-scoring-source.mjs --apply /workspaces/scoring-source.json PASTE_APPROVAL_HASH
```

Save the returned source UUID. Approval is retry-safe and publishing defaults to false.

## 4. Preview and run the collector

```bash
node supabase/tests/run-scheduled-scoring.mjs --preview
node supabase/tests/run-scheduled-scoring.mjs --run
node supabase/tests/run-scheduled-scoring.mjs --status
```

Preview rolls back queue creation and makes no Fantrax requests. Preview-only newly generated job IDs are not persistent. Actual runs save the queue before collecting. Inspect pending/error counts and compare scores against Fantrax. Run again; already completed recent jobs need not be re-fetched until six hours have passed. To explicitly re-read one persisted job or check an older correction:

```bash
node supabase/tests/run-scheduled-scoring.mjs --run PASTE_PERSISTED_JOB_UUID
```

Historical examples without real historical roster checks must remain eligibility-pending. Existing commissioner non-participation corrections must survive identical raw re-reads. A changed manual revision requires review; do not clear it by deleting records.

## 5. Enable automation, then publish validated player breakdowns

In GitHub repository Variables, set `SCORING_PROJECT_CONFIRM` to the test project reference and `SCORING_IMPORTS_ENABLED=true`. The new workflow reuses `TRADE_ROSTER_PROJECT_REF` and the existing `TRADE_ROSTER_DATABASE_URL`, `TRADE_ROSTER_CA_CERT` (full PEM text), and `FANTRAX_COOKIE` secrets. It requires read-only repository permissions and never commits generated files. Keep roster-check storage enabled on the separate roster workflow.

Run **Collect player scoring** manually first. Verify all intended sources/owners, then monitor a daily scheduled run and a Tuesday PGA run. A green run alone is not proof that every period is resolved; check `--status` for pending evidence and the size of the backlog.

After validating a real championship source, publish its read-only breakdown:

```bash
node supabase/tests/configure-scoring-source.mjs --publish PASTE_SOURCE_UUID CONFIRM
```

Historical test sources cannot be published. Before the 2027 championship has actual scoring, the public page should correctly say no published scoring rather than showing test points. Browser-test the dropdown, Cup selection and pending indicators using appropriate disposable championship fixtures. Test unauthenticated public reads and confirm raw tables remain inaccessible.

To halt a source's imports:

```bash
node supabase/tests/configure-scoring-source.mjs --disable PASTE_SOURCE_UUID CONFIRM
```

To hide a published breakdown without deleting scores or history, use
`node supabase/tests/configure-scoring-source.mjs --unpublish PASTE_SOURCE_UUID CONFIRM`.

Publishing player totals is separate from connecting adjusted points to the overall standings. That standings change is not included and still requires your approval.

## Validation boundaries

Local tests use the actual minimized five-sport captures for Python parsing and explicitly synthetic database fixtures for schedules, trade ownership, correction ordering, 79/80/81 boundaries and overlapping Cup separation. No live Fantrax calls, hosted migration, notifications, deployment or production standings updates are performed during implementation. Run the Docker and hosted/browser checks above before production activation.

