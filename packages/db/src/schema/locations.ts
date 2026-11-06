import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps } from './columns.js';
import { organizations } from './organizations.js';

/** read_only: kept for history, no new scheduling (e.g. after a plan downgrade). */
export const locationStatus = pgEnum('location_status', ['active', 'read_only']);

/**
 * A physical workplace (a clinic branch). The operational unit: schedules, shifts and
 * clock-ins belong to a location; each location has its own time zone and geofence.
 * Never deleted (history points at it); made read_only instead. Tenant table (RLS).
 */
export const locations = pgTable(
  'locations',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: citext().notNull(),
    address: text(),
    latitude: doublePrecision().notNull(),
    longitude: doublePrecision().notNull(),
    /** Geofence radius for clock-in, in metres. */
    radiusM: integer().notNull(),
    /** IANA zone, e.g. "Asia/Kolkata". Defines this location's days and weeks. */
    timezone: text().notNull(),
    status: locationStatus().notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('locations_org_name_unique').on(t.orgId, t.name),
    // Target for same-org foreign keys from child tables: (org_id, location_id) must exist
    // here as a pair, so a row can never point at another org's location (see 0003).
    unique('locations_org_id_id_unique').on(t.orgId, t.id),
    // Same limits as the API's Zod schema, enforced again by the database.
    check('locations_latitude_range', sql`${t.latitude} between -90 and 90`),
    check('locations_longitude_range', sql`${t.longitude} between -180 and 180`),
    check('locations_radius_range', sql`${t.radiusM} between 25 and 1000`),
  ],
);

export type LocationRow = typeof locations.$inferSelect;
