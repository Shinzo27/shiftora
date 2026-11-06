import { pgTable, unique, uuid } from 'drizzle-orm/pg-core';

import { citext, id, timestamps } from './columns.js';
import { organizations } from './organizations.js';

/**
 * What an employee IS at work (Nurse, Receptionist, Doctor), used by scheduling
 * ("this shift needs 2 Nurses"). Not to be confused with member_role, which is what a
 * user may DO in the app. Org-wide, not per location. Tenant table (RLS).
 */
export const jobRoles = pgTable(
  'job_roles',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: citext().notNull(),
    ...timestamps,
  },
  (t) => [unique('job_roles_org_name_unique').on(t.orgId, t.name)],
);

export type JobRoleRow = typeof jobRoles.$inferSelect;
