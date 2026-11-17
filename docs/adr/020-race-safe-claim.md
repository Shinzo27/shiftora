# ADR 020 — The claim is a conditional update, and retries are keyed

**Status:** accepted (week 5, D4)
**Context:** building the open-shift marketplace; two nurses, one shift, the same second.

## The problem

An open shift is a row anyone eligible may take. The moment it can be taken, two people will take
it at once — not as an edge case but as the ordinary case, because the shift is announced to
everyone who could want it and they all read the message at breakfast.

Three wrong answers suggest themselves:

1. **Read, check, then write.** `SELECT` the shift, see it is open, `UPDATE` it. Both requests read
   "open" before either writes, and both win. This is the bug the whole day exists to avoid, and it
   is invisible in single-threaded tests.
2. **A lock.** `SELECT … FOR UPDATE` serializes the two claims: the second waits, then sees
   `assigned` and is refused. Correct — but it makes a queue out of a button, and the wait is
   invisible to the person whose phone is on 3G.
3. **A queue.** Put claims on a BullMQ queue with `concurrency: 1`. Also correct, and also wrong:
   it moves a database invariant into infrastructure, and now a Redis outage means nobody can take
   a shift.

## Decision

**The update carries the condition.** `ShiftsRepository.claim` runs:

```sql
update shifts
   set employee_id = $me, status = 'assigned', version = version + 1, offered_at = null
 where id = $id and status = 'open' and employee_id is null and version = $versionRead
```

Both claims read version 3. Both run the statement. The first updates one row and commits; the
second matches nothing — it updated **zero rows** — and the service turns that into
`409 shift.already_taken` with a sentence a person can act on. No lock, no queue, no coordination
in application code: the row itself is the arbiter, and the database is the only thing that can
serialize writes anyway.

Two supporting decisions make this hold:

- **Eligibility is re-checked in the same transaction**, before the update, using the same
  `assessMany`/`canTakeOpenShift` the "who could take it" preview uses. A claim cannot be a way
  around a rule the offer respected.
- **The overlap constraint stays the backstop.** Even if a conditional update were wrong, the
  `EXCLUDE USING gist` on `(employee_id, tstzrange(starts_at, ends_at))` refuses to double-book a
  person. The claim's condition prevents a lost race; the constraint prevents a corrupt rota.

## Idempotency, because a phone retries

A tap that times out is retried — by the browser, by the person, by the network. Without a key,
"retry" means "claim a second shift", which is a rota nobody can work.

`idempotency_keys` (migration `0020`) holds one row per **organisation + route + key**, with a
SHA-256 of the parts of the request that must not change (`[shiftId, userId]`). `IdempotencyService`
reserves the row **before** doing the work:

- The insert is the lock. A concurrent retry blocks on the unique index until the first request
  commits, then reads that request's stored answer and returns it verbatim — same status, same
  body, same `version`.
- The same key used for a different shift is `409 idempotency.key_reuse`, not a silent replay: that
  is a client bug worth naming.
- Everything runs in the request's own transaction, so a request that fails leaves no reservation —
  the row and the effect commit together or not at all.

## Consequences

- The happy path is one extra `UPDATE` on the same row the service already read: no measurable cost.
- The loser's experience is honest: "Someone else took this shift" arrives immediately, and their
  list refetches rather than showing a shift they cannot have.
- `idempotency_keys` is generic. The clock-in path still keys on `client_event_id`; moving it here
  is a follow-up, not a rewrite.
- The claim does not enter the request state machine: a pickup is decided by the race, so it is
  recorded already approved (audit row + `shift.claimed` event, managers told, publication patched).
- Tested by firing three claims in one `Promise.all` at the pooled connection and asserting exactly
  one 200 — a test that fails loudly if anyone ever replaces the conditional update with a
  read-then-write.
