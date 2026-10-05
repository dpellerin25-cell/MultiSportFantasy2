# Trade email delivery

Sender: **Pentagon Cup <notifications@multisportfantasy.com>**. Proposal,
counteroffer, league-wide acceptance, decline and roster-limit notifications use
the private queue.
There is no Reply-To header. Messages say not to reply and link to /rosters.
Email clients still allow Reply; leave this sending address without an inbox or
forwarding rule if you do not want to receive responses.

## Controlled first delivery

Do not put the Resend key in source files, NEXT_PUBLIC variables or chat.
Use a Resend sending-only key scoped to the verified multisportfantasy.com domain.

1. Transfer these reviewed changes to GitHub/Codespaces. In Codespaces:

   ```bash
   cd /workspaces/MultiSportFantasy2
   npx supabase link --project-ref tgvuntuhdqucazpoxrrg
   npx supabase db push --linked --dry-run
   ```

   Confirm the destination is the test project and the new migrations are
   `202610050001_trade_email_delivery.sql` and
   `202610050002_league_email_alerts.sql`, then apply:

   ```bash
   npx supabase db push --linked
   ```

2. GitHub repository > Settings > Secrets and variables > Actions > Secrets:
   - `RESEND_API_KEY`: your Resend key.
   - `TRADE_EMAIL_TEST_RECIPIENT`: Doug's confirmed test-account email. Only
     notifications actually addressed to this account are sent; other owners'
     mail is not redirected here.
   - Reuse existing `TRADE_ROSTER_DATABASE_URL` and `TRADE_ROSTER_CA_CERT`.
     The certificate secret contains PEM text, not a file path. Full TLS
     verification remains enabled.

3. Under **Variables**, add:

   | Name | Value |
   |---|---|
   | TRADE_EMAIL_ENABLED | false |
   | TRADE_EMAIL_MODE | test |
   | TRADE_EMAIL_SITE_URL | https://multi-sport-fantasy2.vercel.app |
   | TRADE_EMAIL_NOT_BEFORE | Current UTC timestamp, e.g. 2026-10-05T18:00:00Z |

   Use the actual current timestamp, not the example. Generate it with
   `date -u +%Y-%m-%dT%H:%M:%SZ`. This deliberately excludes old rehearsal mail.
   The website URL must open the same league/database you are testing.
   Reuse `TRADE_ROSTER_PROJECT_REF=tgvuntuhdqucazpoxrrg`.

4. After that timestamp, sign in as another owner and create a new proposal
   addressed to Doug. In GitHub Actions, run **Send Trade Notifications**, mode
   **preview**. Expect `eligible: 1`, `sent: 0`. Preview changes no queue rows.

5. Set `TRADE_EMAIL_ENABLED=true`. Run the workflow with mode **send**.
   This also enables scheduled delivery about every five minutes (GitHub may
   delay scheduled jobs). Test mode continues restricting delivery to Doug.
   Expect `sent: 1`. Verify the sender, assets and roster link in the actual
   inbox/spam folder and check Resend's delivery status. API acceptance alone
   does not prove inbox delivery.

6. Run send again: expect `sent: 0` for the same event. Test a counteroffer,
   acceptance and decline involving Doug. Acceptance queues one message for every linked active owner, but test mode
   sends only Doug's copy. No email is sent for withdrawal
   or Fantrax completion in this initial integration.

7. Set ENABLED back to false to stop sending. Do not switch the test project to
   live mode: the worker rejects it. When the production database is ready,
   separately configure its verified connection, correct website URL, a fresh
   NOT_BEFORE timestamp and MODE=live, preview, then enable delivery.

## Operation and troubleshooting

Each run processes at most 20 due notifications. A database session lock excludes
concurrent workers. A durable frozen payload plus a stable Resend idempotency key
protect retries, including a lost database connection after provider acceptance.
Resend retains keys for 24 hours; automatic retries stop after 23 hours or eight
attempts. Rate limits and network/server errors retry after ten minutes. Permanent
errors and uncertain old deliveries are held for review, never blindly replayed.
The worker uses a direct or session-pooler PostgreSQL connection, not transaction
pooling. Existing table privacy remains unchanged.

Inspect `trading.notifications` privately in Supabase: `status`, `attempts`,
`last_error`, `provider_id`, `sent_at`. `sent` means provider accepted, not delivered.
The frozen payload contains recipient email and trade details and is private.
Do not publish that table or paste its payloads into logs. Check Resend delivery
logs for bounces. Bounce webhooks are not implemented in this first phase.
Never reset uncertain deliveries or change their keys without checking Resend.

Closed/expired proposal notices, unlinked/unconfirmed recipients, known HTTP test
fixtures and changed recipient addresses are held. Previously suppressed
notifications (`next_attempt_at=infinity`) remain suppressed. Old records before
NOT_BEFORE remain queued but are intentionally excluded.

Offline validation: run `node trade-email.test.mjs` in supabase/tests, or the full
`pnpm test` suite. Tests use an in-memory database and a mocked Resend endpoint;
they do not test actual provider delivery or simultaneous PostgreSQL sessions.

## League announcements and roster-limit alerts

Accepted trades now notify every linked active owner individually, including
both parties, with the heading **A trade is now pending**. Emails contain assets
and owner names but no private negotiation message. Pick-only trades still
complete immediately; the email explains that distinction and links to current
status. Recipients must have confirmed account emails. There is no backfill of
previous acceptance events.

After each successful complete five-sport roster import, an owner with more than
65 players gets one private warning for that continuous violation. Picks do not
count. A repeat import or a change from 66 to 67 players does not send another
warning. A later import at 65 or fewer closes the violation; exceeding 65 again
creates a new alert. Pending alerts are suppressed if corrected before sending.
The email says points accumulated while over the limit do not count toward the
Pentagon Cup and asks the owner to contact Doug after correcting Fantrax if a
website refresh is needed before tomorrow at 4 am Eastern. This is notification
only: it does not automatically remove points or change the scoring importer.

Controlled roster-alert test: use a disposable roster fixture/owner with 66
players, run a complete roster import, then preview/send in test mode. Verify
one warning; rerun the same import and verify no second warning. Correct to 65,
import, then exceed again to verify a new episode. Do not manufacture roster data
in the real league to perform this test. The offline suite covers this flow.
