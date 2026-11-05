# ADR 014: Select the organisation per request with `X-Org-Id`

- Status: Accepted
- Date: 2026-11-05

## Context

A user can belong to several organisations. Every tenant request must run with exactly one
organisation selected (`app.org_id` for RLS), and the caller's role in it must be known.
The first design (ARCHITECTURE.md §8) put the selected org and role in the access token.

## Decision

The client sends the selected organisation in an `X-Org-Id` header on every org-scoped
request. `TenancyInterceptor` checks membership and reads the role from the database inside
the request's transaction, on every request.

## Alternatives considered

- **Org and role as JWT claims.** Saves one indexed query per request, but needs a
  "switch org" endpoint that re-issues tokens, has to remember the selected org across
  refreshes (extra session state), and a removed member or a demoted manager keeps their
  old powers until the token expires (up to 15 minutes).
- **Org id in the URL** (`/orgs/:orgId/shifts`). Works, but every route, link and client call
  carries it, and it is easy to forget to check that the URL org matches a membership.

## Consequences

- Removing a member or changing a role takes effect on their next request.
- Each browser tab can work in a different organisation.
- One extra primary-key lookup per request (`memberships (org_id, user_id)` is unique-indexed).
- The web app must attach `X-Org-Id` to org-scoped calls (one API-client setting).
