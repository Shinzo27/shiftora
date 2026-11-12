# 016 — Realtime: Socket.IO on the same origin, one room per organisation

**Date:** 2026-11-12
**Status:** Accepted (W2 D6)

## Problem

Two managers often have the same week open: the owner at a desk, the manager on a phone. Without
a live channel the second screen shows a week that no longer exists — a drag lands on top of a
shift someone else just moved, or a publish happens twice because the first one is invisible.

Polling every open board would work, but it costs a request per manager per interval forever and
is worst exactly when it matters (many managers, one busy week).

## Decision

**Socket.IO over the API's own HTTP server**, one room per organisation (`org:<uuid>`); the
event payload names the schedule, so a client refetches only when the open week is affected.

- **Auth is the same access token as HTTP.** The handshake carries it in `auth.token`; the
  gateway verifies it with the same `TokenService` and then queries memberships **with the RLS
  context of that user** — no bypass role, no second set of rules. A socket that cannot prove
  membership is disconnected instead of left connected and silent.
- **One room per organisation, filtered by payload.** Rooms per location/week are tempting, but
  membership rules can change mid-session (a manager loses a location) and a socket's rooms would
  go stale. A payload filter is one `if` on the client and always correct.
- **The Redis adapter when `REDIS_URL` is set, in-memory otherwise.** One API instance does not
  need Redis; more than one does, or half the sockets miss the event. Missing Redis is a warning,
  not a crash — the app must run without it in development and tests.
- **Events are emitted after the write, outside the transaction's outcome.** A false positive
  (client refetches a week that did not change) is harmless; a false negative (client misses a
  change) is the bug we are fixing.
- **The outbox is not used for this.** Realtime is a hint to refetch, not a durable
  notification; the durable path for staff (`schedule.published` in the outbox) stays separate.

## Rejected

- **Server-sent events.** One-directional, needs its own auth story through the browser's
  `EventSource` (no headers), and reconnection is manual work Socket.IO already does.
- **Polling.** Simpler, but latency is wrong for a shared board and the cost grows with viewers.
- **Putting the socket auth in a cookie.** The access token is deliberately memory-only; a
  cookie would create a second CSRF surface for no gain.
- **Rooms per location and week.** See above: scope changes mid-session, and the payload filter
  already gives the client the same precision with less state.

## Consequences

- The gateway is disabled in tests (no `IoAdapter`, so no server); `RealtimeService` is a no-op
  without one, which keeps every service callable from a test.
- `@WebSocketGateway`'s options are evaluated before DI exists, so **CORS reads `WEB_ORIGIN`
  from the environment** — the only setting in the app that does not come from `AppConfig`. It
  is documented in AGENTS.md.
- Clients treat the event as "refetch", never as data: no merge logic, no partial updates. The
  HTTP API remains the single source of truth, so a dropped event costs freshness, never
  correctness.
