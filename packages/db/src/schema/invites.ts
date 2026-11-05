import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { citext, id, timestamptz } from './columns.js';
import { memberRole } from './memberships.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

/**
 * An invitation to join an org. The invite code is "<org_id>.<secret>"; only the SHA-256 of
 * the whole code is stored. Tenant table (RLS on org_id).
 */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext().notNull(),
    role: memberRole().notNull(),
    tokenHash: text().notNull().unique('invites_token_hash_unique'),
    invitedBy: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
    acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamptz(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    index().on(t.orgId),
    // At most one open invite per email per org; re-inviting revokes the old one first.
    uniqueIndex('invites_one_open_per_email')
      .on(t.orgId, t.email)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

export type InviteRow = typeof invites.$inferSelect;
