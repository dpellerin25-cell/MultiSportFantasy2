# Commissioner Scoring Controls

The `/scoring-controls` page uses existing website sign-in and appears in navigation only for a commissioner. Every new database API also requires a linked, active commissioner; hiding the navigation is not the security boundary.

## Included

- Pause/resume overage penalties with a reason, preview, explicit confirmation and stale-state protection.
- Daily roster evidence for every active owner: missing/incomplete/complete, actual observation time, player count and the cap effective at that check.
- PGA mixed-pause review: preview standard two-check enforcement or waiver, retain negative points, and bind confirmation to the reviewed roster evidence and previous resolution.
- Paginated audit history. Championship results and historical test examples are separate. The test-results toggle does not change the scope of pause controls: pauses apply across sports.
- Safe same-request retries after an uncertain response while the page remains open. If the browser closes during an uncertain save, reopen and inspect history before submitting a new action.

This page does not import scores, fabricate missing evidence, edit player scores or change published standings. Missing checks remain pending. The existing scoring evaluator and immutable audit records remain authoritative.

## Local verification

From the repository root in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:scoring-controls
node scoring.test.mjs
node daily-scoring-checks.test.mjs
cd ../../web
npm run build
```

These are offline database and client-model tests. They do not prove browser HTTP access or hosted behavior. Existing multi-session scoring tests remain available as `test:scoring-concurrency`; the new APIs delegate mutations to the existing locked scoring commands.

## Test-project rollout

Transfer the reviewed local changes to Codespaces first; no commit or push is performed by this implementation. Then:

```bash
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Verify the intended pending migration is `202610310001_scoring_controls.sql`. Review any additional pending migrations before proceeding. Apply to the test project:

```bash
npx supabase db push --linked
cd web
npm run dev
```

Reuse the existing test Supabase URL/publishable key in `web/.env.local`. No new secrets are needed. Never put database passwords or service-role credentials in the browser configuration.

## Two-account browser validation

1. Sign in as Doug; open **Scoring Controls**. Check the selected Eastern date and owner roster evidence. Tomorrow's scheduled run should supply real evidence; do not invent historical checkpoints.
2. In a separate private browser, sign in as another owner. The navigation link must be absent and visiting `/scoring-controls` directly must show access denied. Sign out and verify data is not displayed.
3. In the test project, enter a reason, review a pause, cancel it, and confirm no history entry was created. Then review and confirm a pause. Confirm the status and history update. Immediately review and confirm resume after testing so the test project is not inadvertently left paused.
4. Use two Doug tabs to review the same pause state. Apply one change, then attempt the older confirmation. It must reject the stale state; refresh and review again.
5. Toggle historical test PGA results. If no mixed-pause fixture exists, no decision buttons are expected: missing roster evidence cannot be waived here. Use an appropriate disposable mixed-pause fixture for the full enforce/waive browser test rather than altering real evidence.
6. For an eligible fixture, verify the preview totals, reason, confirmation and audit history; enforce must retain negatives, and a later waiver must preserve the earlier decision in history.

Hosted HTTP/browser tests and multi-session tests were not run as part of local implementation. No hosted settings or migrations were changed.
