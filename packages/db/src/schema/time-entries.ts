import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, newId, timestamps, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { locations } from './locations.js';
import { shifts } from './shifts.js';

/** How the punch was made. `gps` is the phone; `qr` is a kiosk tablet; `manual` is a manager. */
export const attendanceMethod = pgEnum('attendance_method', ['gps', 'qr', 'manual']);

/**
 * One worked period: a clock-in, and later a clock-out (both optional on the way in).
 *
 * Coordinates are stored, not just the verdict: "16 m from the clinic, ±8 m accuracy" is what
 * settles an argument later. `in_distance_m` is computed by the server from its own copy of the
 * location's coordinates — the client's number is never trusted for the decision.
 *
 * `client_event_id` is the idempotency key from the device (`Idempotency-Key`), unique per org,
 * so a retry after a dead connection cannot produce two clock-ins.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    orgId: uuid().notNull(),
    employeeId: uuid().notNull(),
    locationId: uuid().notNull(),
    /** The shift this punch belongs to, when it is known. */
    shiftId: uuid(),
    clockInAt: timestamptz().notNull(),
    clockOutAt: timestamptz(),
    method: attendanceMethod().notNull().default('gps'),

    inLatitude: doublePrecision().notNull(),
    inLongitude: doublePrecision().notNull(),
    inAccuracyM: integer().notNull(),
    /** Metres from the location, measured by the server. */
    inDistanceM: integer().notNull(),

    outLatitude: doublePrecision(),
    outLongitude: doublePrecision(),
    outAccuracyM: integer(),
    outDistanceM: integer(),

    /** The device's own clock; `received_at` is when the server saw it. Skew is a flag. */
    deviceTime: timestamptz().notNull(),
    receivedAt: timestamptz().notNull().defaultNow(),
    /** `outside_geofence`, `low_accuracy`, `device_skew`… see `packages/domain`. */
    flags: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Set when a manager changed the times by hand (the audit row carries before/after). */
    edited: boolean().notNull().default(false),
    clientEventId: uuid()
      .notNull()
      .$defaultFn(() => newId()),
    ...timestamps,
  },
  (t) => [
    // Same-org composite keys: Postgres checks foreign keys without RLS (AGENTS.md).
    foreignKey({
      name: 'time_entries_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'time_entries_location_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('restrict'),
    // Deleting a shift keeps the punch (the work happened) and clears only the link.
    // drizzle-kit can't express that, so migration 0008 says `ON DELETE SET NULL (shift_id)`
    // by hand — the same gotcha as 0005/0006 (AGENTS.md).
    foreignKey({
      name: 'time_entries_shift_fk',
      columns: [t.orgId, t.shiftId, t.locationId],
      foreignColumns: [shifts.orgId, shifts.id, shifts.locationId],
    }).onDelete('set null'),

    uniqueIndex('time_entries_client_event_unique').on(t.orgId, t.clientEventId),
    // One open punch per employee: a second clock-in without a clock-out is a bug, not data.
    uniqueIndex('time_entries_one_open')
      .on(t.orgId, t.employeeId)
      .where(sql`clock_out_at is null`),
    index('time_entries_employee_time_idx').on(t.orgId, t.employeeId, t.clockInAt),
    index('time_entries_location_time_idx').on(t.orgId, t.locationId, t.clockInAt),

    check('time_entries_period_order', sql`clock_out_at is null or clock_out_at > clock_in_at`),
    check('time_entries_accuracy_positive', sql`in_accuracy_m >= 0`),
    check('time_entries_distance_positive', sql`in_distance_m >= 0`),
  ],
);

export type TimeEntryRecord = typeof timeEntries.$inferSelect;
