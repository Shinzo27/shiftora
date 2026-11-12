import { sql } from 'drizzle-orm';
import { check, integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core';

import { id, timestamps } from './columns.js';

/** Defined with the attendance tables but owned here: it is the tenant's policy. */
export const geofencePolicy = pgEnum('geofence_policy', ['flag', 'reject']);

/**
 * The tenant. Its RLS policy compares `id` (not org_id) with current_org_id(), and also lets
 * members see orgs they belong to, so "list my organisations" works without an org selected.
 */
export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    name: text().notNull(),
    /**
     * What happens when someone clocks in outside the location's radius: `flag` records it and
     * lets the manager decide, `reject` refuses the punch (422) so nobody starts a shift untracked.
     * Flagging is the default — a clinic would rather have the attendance than the argument.
     */
    geofencePolicy: geofencePolicy().notNull().default('flag'),
    /** Minutes of early/late slack that still count as on time. */
    attendanceGraceMinutes: integer().notNull().default(5),
    ...timestamps,
  },
  (t) => [
    // Early/late tolerance: inside it a punch counts as on time (W3 D4).
    check(
      'organizations_grace_range',
      sql`${t.attendanceGraceMinutes} >= 0 and ${t.attendanceGraceMinutes} <= 60`,
    ),
  ],
);

export type OrganizationRow = typeof organizations.$inferSelect;
