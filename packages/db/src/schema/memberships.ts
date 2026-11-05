import { memberRoles } from '@shiftora/domain';
import { index, pgEnum, pgTable, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps } from './columns.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const memberRole = pgEnum('member_role', memberRoles);

/** A user's role in one organisation. Tenant table (RLS on org_id). */
export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole().notNull(),
    ...timestamps,
  },
  (t) => [unique('memberships_org_user_unique').on(t.orgId, t.userId), index().on(t.userId)],
);

export type MembershipRow = typeof memberships.$inferSelect;
