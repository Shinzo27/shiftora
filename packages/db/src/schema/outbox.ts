import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';

/**
 * The transactional outbox: a side effect that must happen (tell staff, send a message) is
 * written here **in the same transaction** as the change that caused it, and a worker relays
 * it later. No request handler ever calls a provider directly, so a crash between "saved" and
 * "sent" loses nothing — the row is still there.
 *
 * Tenant table (RLS). `published_at` is set by the relay (week 4), not by the request.
 */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    /** Null for platform events (an email verification, a password reset): they belong to no tenant. */
    orgId: uuid(),
    /** `entity.past_tense`, e.g. `schedule.published`; the relay routes on this. */
    topic: text().notNull(),
    /** Everything the worker needs; never secrets, never precise coordinates. */
    payload: jsonb().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    /** Null while the event waits for the relay. */
    publishedAt: timestamptz(),
  },
  (t) => [
    check('outbox_topic_format', sql`${t.topic} ~ '^[a-z_]+\\.[a-z_]+$'`),
    index('outbox_org_created_idx').on(t.orgId, t.createdAt),
    // The relay's query: the oldest events still waiting. Partial, so it stays small.
    index('outbox_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.publishedAt} is null`),
  ],
);

export type OutboxRow = typeof outbox.$inferSelect;
