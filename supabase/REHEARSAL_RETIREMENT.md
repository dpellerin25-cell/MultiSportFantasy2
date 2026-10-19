# Retire the identified test rehearsals

Migration `202610190001_retire_rehearsals.sql` adds private administrative
retirement records and makes membership validation ignore explicitly retired
drafts only. Installing it retires nothing. There is no authenticated-client RPC.
Retirement cancels the clock, increments the draft revision and preserves the
current pick, participants, picks, selections and events. Its audit records the
prior state and reason. Retired draft state cannot be resumed or deleted.

The runner only accepts test project `tgvuntuhdqucazpoxrrg` and the exact two
identified fixtures: the nine-owner startup rehearsal and two-owner timer test
awaiting makeups. The already-cancelled timer test is untouched. Real drafts and
other membership blockers remain protected. No trades or owner assets change.

After transferring files, in Codespaces:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
node retire-rehearsals.test.mjs
cd /workspaces/MultiSportFantasy2
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

Check that only the intended new migration is pending, then apply it using
`npx supabase db push --linked`. Keep the existing private DRAFT_TEST_DATABASE_URL
and CA certificate settings. Preview:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
export DRAFT_TEST_CONFIRM=tgvuntuhdqucazpoxrrg
NODE_EXTRA_CA_CERTS="$HOME/.config/multisport-draft/supabase-ca.crt" node retire-test-rehearsals.mjs --preview
```

Review both draft identities, statuses, revisions and history counts. To apply,
set REHEARSAL_RETIRE_APPROVE to the exact printed approval_hash and run the same
command with --apply. A changed revision requires another preview. Both retirements
commit together or roll back together. After an uncertain connection failure,
preview again to see the recorded state. An already-retired pair is a safe no-op.

Then refresh League Settings, review and apply Billy's eleven-owner membership
and the approved points. This is separate from retirement. Account linkage and
future draft order can wait. No deletion or manual resetting of current picks is
needed. For production, assess its actual draft state separately; this runner
must never be retargeted to production.
