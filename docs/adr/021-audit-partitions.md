# ADR 021 — The audit log is partitioned by month, and the worker keeps the months ready

**Status:** accepted (week 7, D4)
**Context:** the owner's audit log screen; `audit_events` only ever grows.

## The problem

Every change to a schedule, shift, punch, pay rule or membership writes an audit row in the same
transaction (AGENTS.md → Audit). A busy clinic writes thousands a month, forever: the table is
append-only and nothing may delete from it. Two things follow:

1. **Reads are by time.** The owner's screen asks for "the last 30 days", "this shift's history",
   "what Ravi changed this week" — always newest first, nearly always a recent window.
2. **Retention will one day be a decision** ("keep seven years"), and on one big table that means a
   `DELETE` of millions of rows — the one statement the table is built to refuse.

## Decision

**`audit_events` is range-partitioned on `created_at`, one partition per UTC month**
(`audit_events_YYYY_MM`, migration `0026`), plus `audit_events_default` as a safety net.

- **Postgres requires the partition key in every unique constraint**, so the primary key is
  `(id, created_at)`. Ids are UUIDv7 and unique on their own; nothing references audit rows by
  foreign key (on purpose, so history survives deletes).
- **RLS, the policy and the grants live on the parent.** app_user can `INSERT`/`SELECT` through
  `audit_events` only. Each partition has `REVOKE ALL … FROM app_user`, because the default
  privileges from `0000` would otherwise grant it, and **a partition queried by name skips the
  parent's RLS**. A test proves a direct `select` from a partition is refused.
- **Partitions are created ahead by `ensure_audit_partitions(months_ahead)`**, a
  `SECURITY DEFINER` function owned by app_owner. It is the *only* thing app_user may call with the
  owner's rights; the helper it uses (`create_audit_partition`) is not executable by app_user. It
  takes an advisory lock, so two workers calling at once create each month once (tested by holding
  the first call's transaction open while the second starts).
- **The worker calls it on boot and daily** (`audit-partitions` job scheduler on the `alerts`
  queue, `apps/worker/src/maintenance/audit-partitions.ts`). Three months ahead are kept ready.
- **A row for a month that does not exist yet lands in the default partition**, never an error;
  the next run moves those rows into their new month before attaching it (`ATTACH` refuses while
  the default holds rows of the range).

## Migrating the existing table

The old table is renamed, the partitioned one created, rows copied into the default partition,
each month with history given its own partition, and the old table dropped — in one transaction.

`FORCE ROW LEVEL SECURITY` binds the **owner** too: with no org set, the migration's read of the old
table returned **zero rows**, and the first draft dropped the full table after copying nothing. A
scratch database with 2,000 rows caught it. The migration now:

- turns `FORCE` off on the old table (it is about to be dropped);
- runs the move under `SET LOCAL row_security = off`, which makes any read RLS would filter an
  **error** instead of a silently short answer;
- compares counts before the `DROP`.

With the `NO FORCE` line deliberately removed, the migration now fails with "query would be
affected by row-level security policy" and leaves the data untouched.

## Alternatives considered

- **One table with a `(org_id, created_at)` index.** Fine for reads for a long time; does nothing
  for retention, and the index itself grows without end.
- **`pg_partman`.** Does exactly this, but is an extension most managed Postgres offerings gate,
  and it is one more moving part for ~40 lines of PL/pgSQL.
- **Creating partitions in migrations only.** Simplest, but the table stops accepting rows into
  real partitions the month nobody deploys; the default partition would quietly fill instead.
- **Letting the worker run DDL as app_owner.** A second, powerful connection string in the worker
  for one housekeeping job. The `SECURITY DEFINER` function gives app_user exactly one capability.

## Consequences

- A query with a date range reads only the months it covers (partition pruning).
- Retention later is `DETACH PARTITION` + archive/`DROP` of whole months — an operator action, not
  something app code can do.
- Partitions are UTC months; a clinic's local month straddles two by a few hours, which affects
  nothing but which file a row lives in.
