# 019 — Two more narrow cross-tenant reads: the alert scan and delivery reports

- **Status:** accepted (week 4, day 5). Extends ADR 017; supersedes nothing.
- **Context:** ADR 017 gave the outbox relay the only cross-tenant read in the system, on one
  table. Week 4 day 5 adds two jobs that also start without an organisation:
  - the **alert scan** (shift reminders, missed clock-ins) runs every minute for every tenant,
    so it has to know which tenants exist;
  - a **delivery report** from WhatsApp names a message only by Meta's id (`wamid…`), so the
    worker has to find which tenant's delivery that is before it can update it.

## Decision

The same mechanism as ADR 017, kept as narrow: a transaction-local switch, a `SELECT`-only
policy on one table, and one query run under it. Migration `0017`:

| Switch | Table | Allows | Used by |
|---|---|---|---|
| `app.alert_scan` | `organizations` | `SELECT` | `scanShiftAlerts` → `listOrgs` (ids and grace minutes) |
| `app.provider_report` | `deliveries` | `SELECT` | `applyDeliveryReports` → `findDelivery` (id, org) |

Everything after the lookup runs under the found org's normal context (`app.org_id`): the scan
queries shifts and writes `shift_alerts` + outbox rows one org at a time; a report is applied
to its delivery row-locked, inside that org.

The webhook itself (API) does **no** tenant work: it verifies the signature and writes a
platform outbox event (`org_id IS NULL`, ADR 018). The worker does the lookup. So the API keeps
its rule "a request touches one tenant, or none", and Meta gets its 200 quickly.

## Why not the alternatives

- **A platform lookup table** (`provider_message_id → org_id`, no RLS) for reports. It would
  expose less than a `SELECT` on `deliveries`, but it is a second copy of the truth that must be
  written in the same transaction as every send and can drift. The policy is one line, the read
  is one query, and the worker already has the rows.
- **Meta's `biz_opaque_callback_data`** (echoing our org id in the report). It moves the tenant
  decision into a value that travels through a third party; the signature makes it authentic but
  not *ours* to trust for isolation.
- **One scan per tenant from a list kept elsewhere** (e.g. Redis). Another source of truth for
  "which orgs exist".
- **`BYPASSRLS` / `SECURITY DEFINER`.** Rejected for the reasons in ADR 017.

## Consequences

- Three switches now exist, each on one table, each `SELECT`-only except the relay's claim.
  `deliveries_provider_report` exposes delivery rows (addresses included) to a transaction that
  sets it — exactly one query in `reports.ts` does. The `app_worker` role from ADR 017 remains
  the fix that makes this a grant instead of a convention.
- Reports are idempotent and monotonic (`applyProviderReport`): Meta resends and reorders, and
  a duplicate or stale report changes nothing.
- The scan's exactly-once is `shift_alerts` (`ON CONFLICT DO NOTHING … RETURNING`), so several
  workers, or a BullMQ job scheduler firing twice, still raise one alert per shift and kind.
