# 017 — The outbox relay is the one process that reads across tenants

- **Status:** accepted (week 4, day 1)
- **Context:** the API writes side effects to `outbox` in the same transaction as the change
  (ADR for week 2 publishing). A worker must pick those rows up and put them on a queue.
  Every tenant table is behind `FORCE ROW LEVEL SECURITY` with `org_id = current_org_id()`, so a
  process with no organisation sees **nothing** — which is the property that makes the tenant
  boundary trustworthy, and exactly what stops a relay from working.

## Decision

The relay runs as `app_user` like everything else, and opens its claim transaction with

```sql
select set_config('app.outbox_relay', 'on', true);
```

Migration `0011` adds two policies to `outbox` only — `SELECT` and `UPDATE`, both
`USING (current_setting('app.outbox_relay', true) = 'on')`. Postgres ORs policies together, so
normal requests still see their own tenant's rows and nothing else; the flag widens the view for
the one transaction that claims pending events, and `set_config(..., true)` makes it vanish at
commit or rollback, so a pooled connection never carries it into a request.

It is the **only** table with a switch like this. *(Update, W4 D5: ADR 019 adds two more of the
same shape, `SELECT`-only — `organizations` for the alert scan, `deliveries` for delivery reports.)* Everything downstream — resolving recipients,
loading an employee, writing a delivery — runs with a normal org context taken from the event,
so the widening is one query wide and one process wide.

## Why not the alternatives

- **A role with `BYPASSRLS`.** Honest, and wrong for this repo: it makes the worker able to read
  every tenant's punches and payroll if it ever grows a query of its own. A policy on one table
  says exactly what is allowed.
- **`SECURITY DEFINER` function.** Would work, but a function that returns other tenants' rows is
  a bigger surface to reason about than a policy, and it hides the widening from anyone reading
  the worker's SQL.
- **Polling per tenant.** Correct by construction and unusable: N queries a tick, and the relay
  still needs to know the tenants.

## Consequences

- The relay's claim query is `select … where published_at is null order by created_at limit N
  for update skip locked`. Several workers can run at once; each takes a different slice.
- The relay **enqueues first and marks `published_at` second, in one transaction**. A failed
  enqueue rolls back and the row stays pending (late, never lost). A crash between the queue
  insert and the commit re-claims the row, and the duplicate is harmless because the BullMQ job
  id is the outbox row id.
- Marking first was rejected: it trades both of those recoverable cases for an unrecoverable
  one — a row that says "published" with nothing behind it.
- A separate `app_worker` role, with grants on `outbox`, `notifications` and `deliveries` only,
  is the change to make before this runs anywhere real; ADR records it so the switch does not
  quietly become permanent architecture.
