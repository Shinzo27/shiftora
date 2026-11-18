import { index, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

import { newId, timestamptz } from './columns.js';

/**
 * Append-only record of who changed what. app_user may only INSERT and SELECT (UPDATE and
 * DELETE are revoked in the migration). Tenant table (RLS on org_id). No foreign keys on
 * purpose: the history must survive deletes.
 *
 * **Partitioned by month on `created_at`** (W7 D4, migration 0026 — drizzle-kit does not model
 * partitioning, so the SQL there is hand-written). Postgres requires the partition key in every
 * unique constraint, hence the primary key `(id, created_at)`; ids are UUIDv7 and unique anyway.
 * A month's partition is `audit_events_YYYY_MM` (UTC months), created ahead of time by
 * `ensure_audit_partitions()`, which the worker calls daily; `audit_events_default` catches
 * anything that arrives before its month exists, and the next run moves those rows into place.
 * app_user has no privileges on the partitions themselves, only on this parent, so RLS can't be
 * bypassed by naming a partition.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid()
      .notNull()
      .$defaultFn(() => newId()),
    orgId: uuid().notNull(),
    /** Null for system actions (jobs). */
    actorUserId: uuid(),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: uuid().notNull(),
    before: jsonb(),
    after: jsonb(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index().on(t.orgId, t.entity, t.entityId),
    index().on(t.orgId, t.createdAt),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
