import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { jobRoles } from './job-roles.js';
import { schedules } from './scheduling.js';

export const shiftStatus = pgEnum('shift_status', ['open', 'assigned', 'cancelled']);

/**
 * One shift on a schedule: a real time range at one location, optionally assigned to an
 * employee. `starts_at`/`ends_at` are instants (UTC); the wall clock the manager saw comes
 * from the location's zone. Tenant table (RLS).
 *
 * Two guarantees live in the database, not in the service:
 * - a shift cannot be double-booked: `EXCLUDE USING gist` on (employee_id, tstzrange), for
 *   assigned shifts only (added by hand in migration 0006, drizzle-kit can't express it);
 * - a shift belongs to its schedule's location and org: composite foreign keys, because
 *   Postgres checks foreign keys without RLS.
 *
 * Counted per employee across every location: overlap, weekly hours and rest (ARCHITECTURE §7.1a).
 */
export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    orgId: uuid().notNull(),
    scheduleId: uuid().notNull(),
    locationId: uuid().notNull(),
    /** Null = no particular role. Cleared if the role is deleted (see the migration). */
    jobRoleId: uuid(),
    /** Null = open shift: nobody assigned yet. */
    employeeId: uuid(),
    startsAt: timestamptz().notNull(),
    endsAt: timestamptz().notNull(),
    /** Unpaid break inside the shift, so paid time can be shorter than elapsed time. */
    breakMinutes: integer().notNull().default(0),
    status: shiftStatus().notNull().default('open'),
    /** Increases on every change; clients send it back to detect concurrent edits. */
    version: integer().notNull().default(1),
    notes: text(),
    ...timestamps,
  },
  (t) => [
    // The schedule decides the week AND the location: a shift can't be in another branch.
    foreignKey({
      name: 'shifts_schedule_fk',
      columns: [t.orgId, t.scheduleId, t.locationId],
      foreignColumns: [schedules.orgId, schedules.id, schedules.locationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'shifts_employee_same_org_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('restrict'),
    // Migration 0006 narrows this to SET NULL (job_role_id): nulling org_id too would fail.
    foreignKey({
      name: 'shifts_job_role_same_org_fk',
      columns: [t.orgId, t.jobRoleId],
      foreignColumns: [jobRoles.orgId, jobRoles.id],
    }).onDelete('set null'),
    unique('shifts_org_id_id_unique').on(t.orgId, t.id),
    // Required as the target of `time_entries (org_id, shift_id, location_id)`: a punch can
    // only belong to a shift in the same location (0008).
    unique('shifts_org_id_id_location_unique').on(t.orgId, t.id, t.locationId),
    check('shifts_time_positive', sql`${t.endsAt} > ${t.startsAt}`),
    check('shifts_break_range', sql`${t.breakMinutes} between 0 and 240`),
    check(
      'shifts_break_shorter',
      sql`${t.breakMinutes} * 60 < extract(epoch from (${t.endsAt} - ${t.startsAt}))`,
    ),
    // An assigned shift has someone on it; an open one has nobody. Cancelled keeps history.
    check(
      'shifts_status_matches_employee',
      sql`(${t.status} = 'assigned' and ${t.employeeId} is not null)
          or (${t.status} = 'open' and ${t.employeeId} is null)
          or ${t.status} = 'cancelled'`,
    ),
    check('shifts_version_positive', sql`${t.version} >= 1`),
    index('shifts_org_schedule_idx').on(t.orgId, t.scheduleId),
    // Every check for one employee (overlap, hours, rest) walks this index.
    index('shifts_org_employee_start_idx').on(t.orgId, t.employeeId, t.startsAt),
    index('shifts_org_location_start_idx').on(t.orgId, t.locationId, t.startsAt),
  ],
);

export type ShiftRow = typeof shifts.$inferSelect;
