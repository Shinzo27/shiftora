import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { users } from './users.js';

/**
 * What a one-time token is for. Both are platform concerns: they prove an address belongs to a
 * person, or that a person may choose a new password — neither is tenant business.
 */
export const oneTimeTokenPurpose = pgEnum('one_time_token_purpose', [
  'verify_email',
  'reset_password',
]);

/**
 * A single-use, expiring token, stored as a hash.
 *
 * Platform-level table like `users` and `sessions`: no `org_id`, no RLS, because a person who
 * cannot log in yet belongs to no organisation. The raw token exists only in the email that
 * carries it; a database leak yields hashes that expire.
 */
export const oneTimeTokens = pgTable(
  'one_time_tokens',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: oneTimeTokenPurpose().notNull(),
    /** Hex SHA-256 of the token. The token itself is never stored. */
    tokenHash: text().notNull().unique('one_time_tokens_hash_unique'),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('one_time_tokens_user_purpose_idx').on(t.userId, t.purpose, t.createdAt)],
);

export type OneTimeTokenRow = typeof oneTimeTokens.$inferSelect;
