import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { users } from './users.js';

/**
 * One row per refresh token. Rotating a token revokes its row and inserts a new one in the
 * same family (one family = one login). Platform-level table: no org_id, no RLS.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Id of the first session of this login; shared by every rotation of it. */
    familyId: uuid().notNull(),
    /** Hex SHA-256 of the refresh token. The token itself is never stored. */
    tokenHash: text().notNull().unique('sessions_token_hash_unique'),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
    /** Session that replaced this one when it was rotated. */
    replacedBy: uuid(),
    userAgent: text(),
    ip: text(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index().on(t.userId), index().on(t.familyId)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
