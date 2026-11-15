# ADR 018 — Account mail is platform mail, not tenant mail

**Status:** accepted (week 4, D3)
**Context:** W4 D3, while adding email verification and password reset.

## The problem

The notification pipeline built in D1–D2 is deliberately tenant-shaped. `outbox.org_id` was
`NOT NULL`, `notifications.org_id` is `NOT NULL` with RLS, and every policy is written against
`current_org_id()`. That is the right shape for "the rota changed, tell the staff": every message
belongs to a clinic, and a clinic must never see another clinic's messages.

Two emails do not fit. "Confirm your address" and "choose a new password" belong to a **person**,
and the moment they are most needed is the moment the person has no organisation: a new signup has
a user row and nothing else; a locked-out user is equally tenantless. There is no `org_id` to write,
and inventing a "system org" would mean every tenant table needs a special case for the row that
is not a tenant.

## Decision

Account mail is **platform mail**, and it takes a different path from staff mail:

1. `outbox.org_id` becomes **nullable** (migration `0014`), and a second policy,
   `outbox_platform_insert`, permits `WITH CHECK (org_id IS NULL)`. Postgres ORs permissive
   policies, so a request inside org A can insert an org-less row and still cannot touch another
   tenant's rows.
2. `OutboxService.recordPlatform()` writes those rows on its **own connection**, not the request
   transaction. Auth routes (`/@Public`, no org) have no request transaction to join; a lost event
   costs one email, and `POST /auth/password/forgot` can always be repeated.
3. The worker's handler for `auth.verify_email` / `auth.reset_password` renders a template and
   sends it **directly** through the mailer. It does not create `notifications`/`deliveries` rows:
   those tables are tenant tables with a `NOT NULL org_id`, and neither row has anything useful to
   say to a clinic's accountant.
4. The record that matters is the **token row**, not the delivery: `one_time_tokens` holds a
   SHA-256 hash, an expiry, and `used_at`, and redemption is a conditional UPDATE. The raw token
   exists only in the email.
5. Invites stay on the tenant path (`invite.created`), because an invite *is* a clinic's message
   and the manager who sent it should be able to see that it went.

## Consequences

- One rule survives with an explicit exception instead of a silent one: "side effects go through
  the outbox", and "tenant messages go through `notifications`".
- Platform mail has no delivery row, so "did it arrive?" is answered by the provider's message id
  in the worker log plus the token's `used_at`. Acceptable for transactional auth mail; it would
  not be acceptable for a rota reminder.
- A dangling `outbox.org_id IS NULL` row is invisible to every tenant context by construction,
  which is what we want: account events are not a clinic's business.
- If push/WhatsApp are ever needed for account mail (e.g. OTP by SMS), the same split applies: a
  separate address, not a fake tenant.
