import { index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';

/**
 * Append-only record of who changed what. app_user may only INSERT and SELECT (UPDATE and
 * DELETE are revoked in the migration). Tenant table (RLS on org_id). No foreign keys on
 * purpose: the history must survive deletes. Partitioning and the owner UI come in week 7.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
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
  (t) => [index().on(t.orgId, t.entity, t.entityId), index().on(t.orgId, t.createdAt)],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
