import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps, timestamptz } from './columns.js';
import { jobRoles } from './job-roles.js';
import { locations } from './locations.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const employeeStatus = pgEnum('employee_status', ['active', 'archived']);
export const notifyChannel = pgEnum('notify_channel', ['email', 'whatsapp', 'sms', 'push']);

/**
 * A person who works shifts. Separate from `users`: most staff are created by a manager and
 * may never log in. `user_id` links the employee to a member's login when they have one.
 * Archived, never deleted (shifts and timesheets point here). Tenant table (RLS).
 */
export const employees = pgTable(
  'employees',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    name: text().notNull(),
    email: citext(),
    /** E.164, e.g. +919812345678 (needed for WhatsApp/SMS). */
    phone: text(),
    /** Pay per hour in minor units (paise). */
    hourlyRateMinor: integer().notNull().default(0),
    currency: text().notNull().default('INR'),
    /** Null = no weekly cap. */
    maxWeeklyMinutes: integer(),
    /** Minimum rest between two shifts. Null = no rule. */
    minRestMinutes: integer(),
    notifyChannel: notifyChannel().notNull().default('email'),
    status: employeeStatus().notNull().default('active'),
    ...timestamps,
  },
  (t) => [
    unique('employees_org_id_id_unique').on(t.orgId, t.id),
    uniqueIndex('employees_org_email_unique')
      .on(t.orgId, t.email)
      .where(sql`${t.email} is not null`),
    uniqueIndex('employees_org_user_unique')
      .on(t.orgId, t.userId)
      .where(sql`${t.userId} is not null`),
    check('employees_rate_non_negative', sql`${t.hourlyRateMinor} >= 0`),
    check('employees_max_weekly_range', sql`${t.maxWeeklyMinutes} between 0 and 10080`),
    check('employees_min_rest_range', sql`${t.minRestMinutes} between 0 and 2880`),
  ],
);

/** Which job roles an employee can fill (a nurse who can also cover reception). */
export const employeeJobRoles = pgTable(
  'employee_job_roles',
  {
    orgId: uuid().notNull(),
    employeeId: uuid().notNull(),
    jobRoleId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.employeeId, t.jobRoleId] }),
    foreignKey({
      name: 'employee_job_roles_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'employee_job_roles_job_role_fk',
      columns: [t.orgId, t.jobRoleId],
      foreignColumns: [jobRoles.orgId, jobRoles.id],
    }).onDelete('cascade'),
  ],
);

/** Which locations an employee works at. */
export const employeeLocations = pgTable(
  'employee_locations',
  {
    orgId: uuid().notNull(),
    employeeId: uuid().notNull(),
    locationId: uuid().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.employeeId, t.locationId] }),
    foreignKey({
      name: 'employee_locations_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'employee_locations_location_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
  ],
);

/**
 * Recurring weekly availability in LOCAL wall-clock time (ISO weekday 1 = Monday).
 * end_local <= start_local means the window runs overnight into the next day.
 */
export const availability = pgTable(
  'availability',
  {
    id: id(),
    orgId: uuid().notNull(),
    employeeId: uuid().notNull(),
    weekday: smallint().notNull(),
    startLocal: time().notNull(),
    endLocal: time().notNull(),
  },
  (t) => [
    foreignKey({
      name: 'availability_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    check('availability_weekday_range', sql`${t.weekday} between 1 and 7`),
    check('availability_not_empty', sql`${t.startLocal} <> ${t.endLocal}`),
  ],
);

/** Exact periods an employee can't work (leave, appointments), as UTC instants. */
export const timeOff = pgTable(
  'time_off',
  {
    id: id(),
    orgId: uuid().notNull(),
    employeeId: uuid().notNull(),
    startsAt: timestamptz().notNull(),
    endsAt: timestamptz().notNull(),
    reason: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'time_off_employee_fk',
      columns: [t.orgId, t.employeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('cascade'),
    check('time_off_positive', sql`${t.endsAt} > ${t.startsAt}`),
  ],
);

export type EmployeeRow = typeof employees.$inferSelect;
export type AvailabilityRow = typeof availability.$inferSelect;
export type TimeOffRow = typeof timeOff.$inferSelect;
