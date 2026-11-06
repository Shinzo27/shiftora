import { foreignKey, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';

import { timestamptz } from './columns.js';
import { locations } from './locations.js';
import { memberships } from './memberships.js';

/**
 * Restricts a member (manager, employee, kiosk) to specific locations. No rows for a member
 * means "all locations"; owners always have all. Tenant table (RLS).
 * Both foreign keys include org_id, so a scope can't link a member and a location from
 * different orgs, and removing the membership or location removes the scope.
 */
export const membershipLocations = pgTable(
  'membership_locations',
  {
    orgId: uuid().notNull(),
    userId: uuid().notNull(),
    locationId: uuid().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.userId, t.locationId] }),
    foreignKey({
      name: 'membership_locations_membership_fk',
      columns: [t.orgId, t.userId],
      foreignColumns: [memberships.orgId, memberships.userId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_locations_location_same_org_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
  ],
);

export type MembershipLocationRow = typeof membershipLocations.$inferSelect;
