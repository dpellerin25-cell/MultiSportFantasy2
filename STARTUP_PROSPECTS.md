# Startup 2027 prospect pool

The supplied workbook contains **92 players: 35 NFL, 30 NBA, 27 soccer**. Names, accents and positions are preserved exactly; spreadsheet order is not treated as a ranking. `data/startup-prospects-2027.json` records the workbook hash and stable catalogue keys. No external roster claims or invented Fantrax IDs are used.

The **Prospects** tab follows PGA. These players appear only there, not under All or the regular sport tabs. Soccer is internally associated with the soccer sport for identity/cap integration, but displayed as outside EPL. Prospects do not fill proposed starting lineups. Search, position filters and alphabetical cursor pagination work within the tab.

Attachment is a separate approved setup operation, not part of the immutable Fantrax snapshot. It is limited to an unstarted Cup 2027 startup draft with no generated picks. No existing rehearsal is modified by migration. The normal draft command enforces turns, one player/slot, revision and request retries. A prospect pick or makeup assignment creates an audited manual prospect on that owner immediately, counting once toward the cap. Undo removes that slot in the same transaction; it refuses if subsequent owner removal or Fantrax confirmation changed the holding. The original selection/audit remains intact. Existing commissioner management and owner-drop warnings continue to apply.

Future verified ID linking uses the existing commissioner controls and preserves the draft identity. Same-owner Fantrax import then ends the manual slot. If another canonical identity already exists for that Fantrax ID, linking stops for a reviewed merge; it never guesses from names. Existing current roster evidence is required before linking. These picks do not send writes to Fantrax.

## Rollout

No hosted changes, commits or deployment are performed by local development.

After transferring the changes to Codespaces:

```bash
cd /workspaces/MultiSportFantasy2
node supabase/tests/startup-prospects.test.mjs
node supabase/tests/prospects.test.mjs
cd supabase/tests
npx --yes pnpm@11.25.0 test:prospects-concurrency
cd ../../web
npm run build
cd ..
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Review `202611060001_startup_prospect_pool.sql`, then apply it with `npx supabase db push --linked`. Deploy the matching UI. Import the fresh five-sport Fantrax pool and create the startup draft in setup status using the existing setup tool; do not start it yet.

Attach the supplemental catalogue with the real setup draft UUID:

```bash
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
export NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt"
node supabase/tests/attach-startup-prospects.mjs --preview DRAFT_UUID
node supabase/tests/attach-startup-prospects.mjs --apply DRAFT_UUID APPROVAL_HASH
```

Use your private `DRAFT_TEST_DATABASE_URL`. Preview runs attachment inside a rolled-back transaction and reports count/hash. Apply checks the draft revision, pool and catalogue before committing. After an uncertain connection, preview again: an already-attached catalogue reports `added: 0`, and no duplicate identities or pool rows are created. Re-running the original base setup tool after supplementing may report a pool difference; use the attachment preview to inspect supplemental state instead of recreating the draft.

If a stored player might match a listed prospect, attachment stops for review. The optional fourth argument is a reviewed JSON mapping file from catalogue key to an existing same-sport player UUID or `new` (explicitly verified distinct identity). For preview pass `-` as the third argument before the mapping file; apply uses the preview hash. An already-known Fantrax identity must be eligible in the imported pool, not bypassed. Do not manufacture mappings just to dismiss a blocker.

Check with two accounts in a disposable draft: tab visibility, owner turn, selection disappearance for both accounts, roster cap, skipped-pick assignment, undo, and later verified ID confirmation. The actual startup draft must remain unstarted until draft day.
