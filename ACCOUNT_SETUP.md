# Owner invitations and password reset

## Implemented flow

The sign-in dialog now includes **Create an Account** and **I'm an idiot and forgot my password**. New accounts use owner-specific email invitations, not the shared league password. There is no self-service owner dropdown that can claim another owner's identity.

Doug opens **League Settings → Owner Invitations**, selects an unlinked active owner, enters their email and confirms it. The server checks the commissioner's real session before using Supabase's administrative invitation API. The owner verifies the invited email, chooses a password of at least 12 characters and accepts their owner link. The database checks the verified email directly from Auth, not editable user metadata. Invitations cannot grant commissioner privileges or replace an existing owner link.

Pending invitations can be revoked. Owner approvals expire after seven days; the actual email token has Supabase's configured, usually shorter, expiry. Accepted links persist independently of invitation expiry. Existing accounts are not overwritten: Doug can approve their email, then they sign in and visit `/auth/create` to accept. If an existing account is unverified, finish its Auth verification before linking.

Each send uses a request ID. Repeating it does not send another email. An interrupted send can leave delivery as `pending` or `unknown`; inspect Supabase Auth/email delivery logs before any resend. Revoking an invitation stops league linking but does not delete the Auth user or invalidate already-issued Auth email tokens. Such an unlinked user has no owner privileges.

Password reset always gives a non-enumerating response and reminds the owner to check spam. It changes the password through Supabase Auth and does not mutate owner links. Email-link tokens are removed from the address bar on arrival. The recommended templates below delay token consumption until the owner presses **Continue securely**.

## Codespaces tests and test-project migration

After transferring the reviewed changes:

```bash
cd /workspaces/MultiSportFantasy2/supabase/tests
npx --yes pnpm@11.25.0 install --frozen-lockfile --ignore-scripts
npx --yes pnpm@11.25.0 test:owner-invitations
cd ../../web
npm run build
cd ..
npx supabase link --project-ref tgvuntuhdqucazpoxrrg
npx supabase db push --linked --dry-run
```

The new migration is `202611020002_owner_invitations.sql`. Review any other pending migrations before applying:

```bash
npx supabase db push --linked
```

No migration, hosted setting, account creation or email send is performed by the offline tests. They test permission denial, verified-email binding, protected owner links, expired/revoked invitations, retries, audit preservation, redirect validation and password validation. Hosted email delivery and two-browser acceptance still need testing.

## Website environment settings

Continue using the existing test project's `NEXT_PUBLIC_DRAFT_SUPABASE_URL` and `NEXT_PUBLIC_DRAFT_SUPABASE_PUBLISHABLE_KEY`. The existing website client currently permits the test project only; production connection rollout is a separate task.

Add privately in `web/.env.local` for your preview and, later, the appropriate Vercel environment:

```dotenv
NEXT_PUBLIC_AUTH_SITE_URL=https://YOUR-EXACT-WEBSITE-HOST
SUPABASE_SERVICE_ROLE_KEY=YOUR_TEST_PROJECT_SERVER_ONLY_SERVICE_ROLE_KEY
AUTH_INVITES_ENABLED=true
```

`NEXT_PUBLIC_AUTH_SITE_URL` must be the exact trusted website origin, with no path/query/fragment. For Codespaces, use its forwarded HTTPS port-3000 URL, and keep that preview running while testing email links. `http://localhost:3000` is supported for local testing on the same computer. Rebuild/restart after changing public environment values.

The service-role key is a private server credential. Never prefix it with `NEXT_PUBLIC_`, paste it into chat, or commit it. It is used only after commissioner authorization on the invitation route. Password reset uses the existing public Auth client. Leave `AUTH_INVITES_ENABLED` unset/false until the email configuration below is ready.

## Supabase Auth configuration — test project first

1. Set the Auth **Site URL** to the same trusted origin as `NEXT_PUBLIC_AUTH_SITE_URL`.
2. Add the exact `https://YOUR-EXACT-WEBSITE-HOST/auth/complete` URL to allowed redirects. Avoid broad wildcards.
3. Keep email confirmation enabled. Disable unrestricted new-user signups for this invitation-only flow; admin invitations are created by Doug through the server. Keep password/email sign-in enabled for existing owners.
4. Set a minimum password length of 12 and retain Auth's rate limits. Do not lower rate limits to bypass errors; the UI also limits commissioner invitation creation to five per minute.
5. Configure **custom SMTP**. The trade-notification Resend API integration does not configure Auth email delivery. Supabase's default sender is restricted and unsuitable for inviting all league members.

For your verified Resend domain, use:

| Setting | Value |
|---|---|
| Sender name | Pentagon Cup |
| Sender address | notifications@multisportfantasy.com |
| SMTP host | smtp.resend.com |
| Port | 465 |
| Username | resend |
| Password | Your private Resend API key authorized for this domain |

Auth email delivery is handled by Supabase through SMTP. Disable link tracking for authentication emails. Replies are not handled by this feature; do not promise that replying is technically impossible.

Official references: [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend SMTP](https://resend.com/changelog/smtp-service), [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [allowed redirects](https://supabase.com/docs/guides/auth/redirect-urls).

## Auth email templates

In Supabase Auth email templates, set **Invite User** to:

```html
<h2>You're invited to Pentagon Cup</h2>
<p>Doug has approved an owner account for this email address.</p>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=invite">Create your account</a></p>
<p>Choose your password after opening the link. If it has expired, contact Doug.</p>
<p>This mailbox is not monitored. Contact Doug directly for help.</p>
```

Set **Reset Password** to:

```html
<h2>Reset your Pentagon Cup password</h2>
<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=recovery">Choose a new password</a></p>
<p>If you did not request this email, you can ignore it.</p>
<p>This mailbox is not monitored. Contact Doug directly for help.</p>
```

The website always supplies the configured `/auth/complete` redirect when it requests these emails. Dashboard-originated emails may not supply that same redirect: test the website flow, and use the exact configured website callback if sending manually from Auth administration. The callback also supports Supabase's default implicit invite/recovery token fragments, but the custom templates better avoid email-scanner consumption.

## Live validation checklist

1. Use a controlled test email and an **unlinked** test owner. Do not unlink a real owner to make this test possible.
2. As Doug, create one invitation. Verify the email and spam placement, open the link in a private browser, choose a password and confirm the displayed owner identity after signing in. Test draft/trade access for that owner.
3. Retry owner acceptance and confirm there is still just one link and no commissioner role. Verify a different email/account cannot accept that invitation.
4. As a non-commissioner, verify invitation management is denied, including direct API/RPC calls.
5. Request a password reset. Verify the email, change the password, sign out, and sign in with the new password. Confirm the same owner/team remains linked. Confirm an expired/used link is rejected and an unknown email receives the same on-screen response.
6. Test revocation with a separate unaccepted invitation. It must not claim an owner, even if the old email link still verifies an Auth account.
7. If delivery is uncertain, inspect Auth and Resend logs. Never repeatedly create new requests to the same owner/email to force delivery. Existing approvals can be used by an already verified account at `/auth/create`; an unverified existing account requires Auth verification/resend assistance.

No hosted configuration, invitations, notifications, commits, pushes or deployments are made by the implementation itself.
