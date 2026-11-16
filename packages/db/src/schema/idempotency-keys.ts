import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { organizations } from './organizations.js';

/**
 * A record of "this request has already been answered".
 *
 * The key a client sends is not a permission and not a lock: it is a promise that a retry of the
 * same request (a flaky phone, a double tap, a network that swallowed the response) gets the
 * first answer instead of a second effect. Stored per organisation and route, with a hash of the
 * request body, so the same key used for a different shift is a mistake we can name.
 *
 * `response_status` and `response_body` are nullable only for the moment between reserving the
 * row and writing the answer — the CHECK keeps the two in step.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** e.g. `POST /me/open-shifts/:id/claim` — a key is only meaningful within one route. */
    route: text().notNull(),
    key: text().notNull(),
    /** SHA-256 of the parts of the request that must not change between retries. */
    requestHash: text().notNull(),
    responseStatus: integer(),
    responseBody: jsonb(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idempotency_keys_scope_unique').on(t.orgId, t.route, t.key)],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
