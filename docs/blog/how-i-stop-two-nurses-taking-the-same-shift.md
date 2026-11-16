# How I stop two nurses taking the same shift

*A clinic manager posts a Saturday shift to the team's WhatsApp group. Two nurses tap "take it"
within four seconds of each other. One of them is about to turn up to a shift that is not hers.*

This is the story of one `UPDATE`, why the obvious versions of it are wrong, and the test that
proves it.

## The shape of the problem

Shiftora is a scheduling app for small clinics. A manager builds a week, publishes it, and staff
get their shifts where they already are — WhatsApp, SMS, email, a push notification. Open shifts
are the same idea with a hole in the middle: a shift exists, nobody is on it, and anyone qualified
may take it.

"May take it" is where the trouble starts. The eligible list is not one person; it is everyone at
that branch with the right job role who is free that afternoon. The message goes out to all of
them at once — that is the entire point of an open shift — so the two taps do not arrive seconds
apart by accident. They arrive together because they were invited together.

## The three fixes that do not work

**Read, check, write.** The first version any of us writes:

```ts
const shift = await db.select().from(shifts).where(eq(shifts.id, id));
if (shift.status !== 'open') throw new Conflict('Already taken');
await db.update(shifts).set({ employeeId }).where(eq(shifts.id, id));
```

Both requests read `open`. Both write. One shift, two owners, and the database let it happen
because nothing in it ever said "only one". Single-threaded tests pass with flying colours, which
is what makes this bug so expensive: it only exists in production.

**A row lock.** `SELECT … FOR UPDATE` before the check fixes the correctness and adds a queue: the
second nurse waits for the first request to finish — a wait that is invisible to her, because her
phone is still showing a spinner. Worse, the lock is held across the eligibility checks, so the
wait is not one statement but several.

**A job queue.** Put claims on a Redis-backed queue with concurrency 1. Also correct. Also wrong:
a database invariant has been moved into infrastructure that can be down, and now a Redis outage
means nobody can take a shift — for a small clinic, an outage that costs real money.

## What actually works: the update carries the condition

Two claims, one statement. Let the second one update nothing.

```sql
update shifts
   set employee_id = $me,
       status = 'assigned',
       version = version + 1,
       offered_at = null
 where id = $id
   and status = 'open'
   and employee_id is null
   and version = $version_read
```

Both requests read the shift at version 3. Both send that statement. Postgres serializes the two
writes on the row: the first updates one row and commits; the second matches **zero rows**, because
by then `status` is `assigned` and the version is 4. Zero rows updated is not an error — it is the
answer. The service turns it into:

```
409 shift.already_taken — "Someone else took this shift."
```

Three properties make this the right tool here:

- **No coordination in application code.** There is no "who got here first" logic to get subtly
  wrong; the arbiter is the row, which is also the thing that can only have one value.
- **No wait.** The loser learns immediately, and her screen can refetch while she is still looking
  at it.
- **It composes with a constraint.** The same table already has an `EXCLUDE USING gist` constraint
  that refuses to double-book a person across overlapping shifts. The conditional update prevents a
  *lost race*; the constraint prevents a *corrupt rota*, even if someone edits a shift into an
  overlap by another route. Two layers, each doing one job.

The version check matters even though `status = 'open'` is in the predicate: a manager can move or
edit the shift while the offer is out. If the version changed, the shift the nurse agreed to is not
the shift on the row any more, and losing the claim is the honest answer.

## The second half: phones retry

A tap that times out is retried. By the browser, by the person, by a flaky network. Without help,
"retry" means "claim a second shift", and now the rota has a person on two shifts they cannot both
attend.

The answer is an idempotency key, but the interesting part is not the key — it is **where the row
is written**:

```ts
const reserved = await keys.reserve({ orgId, route, key, requestHash });
if (!reserved) {
  const existing = await keys.find(orgId, route, key);   // select … for update
  if (existing.requestHash !== requestHash) throw reuse();
  return existing.response;                               // byte for byte
}
const outcome = await run();
await keys.store(row.id, outcome);
```

The reservation is inserted **before** the work, inside the request's transaction. That makes the
unique index the lock: a concurrent retry blocks on it until the first request commits, then reads
the stored answer and returns it — same status, same body, same `version`. A request that fails
takes its reservation with it, so a genuine failure is retryable while a completed request never is.

Two details that turned out to matter:

- **Hash the request.** The same key with a different shift is a client bug, not a retry. Saying so
  (`idempotency.key_reuse`) is better than silently returning an answer about a different row.
- **Scope the key to organisation and route.** Idempotency is not a global namespace; a key is
  meaningful only inside the request it was minted for.

## The test that makes it real

A test that fires claims one after another proves nothing. The one that matters runs them
together, and at the pool — not on a single connection, which would serialize them in the client
and hide the very race it is meant to find:

```ts
const results = await Promise.all([
  claim(asha, shiftId, newKey()),
  claim(rohan, shiftId, newKey()),
  claim(owner, shiftId, newKey()),
]);
expect(results.filter((r) => r.status === 200)).toHaveLength(1);
expect(results.filter((r) => r.status === 409)).toHaveLength(2);
```

And the retry test is its twin: same key twice, and the assertion is not "no error" but "the same
body, one audit row, one event, one assignment".

Both of these fail loudly if anyone ever replaces the conditional update with a read-then-write,
which is exactly what a test should be for a rule like this.

## What I would tell someone starting this

- **Find the races before the users do.** Any feature that sends one invitation to many people
  creates a race at the moment they accept. Design the write, not just the notification.
- **Prefer the database to your own coordination.** Locks are for protecting multi-statement
  invariants; a single-row rule does not need one, and a queue certainly does not.
- **Treat "zero rows updated" as an answer.** It is the cleanest signal a race gives you, and it
  costs one `if`.
- **Idempotency is a table, not a habit.** If the row is not written before the work, you have a
  hope, not a guarantee.
- **Test at the pool, in parallel, or do not claim to have tested it.**

The whole thing is about sixty lines of production code and eight integration tests. The
sixty lines are the easy part once you stop believing that checking before writing is checking
anything at all.
