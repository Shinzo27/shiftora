import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext, id, timestamps, timestamptz } from './columns.js';
import { jobRoles } from './job-roles.js';
import { locations } from './locations.js';

/**
 * A reusable shift pattern at one location ("Morning 07:00–15:00, 30 min break"). Times are
 * LOCAL wall-clock times in the location's zone; an end not after the start runs overnight.
 * Turning a template into a real shift on a date happens in packages/domain (shiftTimes).
 * Tenant table (RLS).
 */
export const shiftTemplates = pgTable(
  'shift_templates',
  {
    id: id(),
    orgId: uuid().notNull(),
    locationId: uuid().notNull(),
    name: citext().notNull(),
    startTime: time().notNull(),
    endTime: time().notNull(),
    /** Unpaid break inside the shift. */
    breakMinutes: integer().notNull().default(0),
    /** Optional: the job role this shift is for (Nurse). Cleared if the role is deleted. */
    jobRoleId: uuid(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'shift_templates_location_same_org_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
    // Migration 0005 narrows this to SET NULL (job_role_id): nulling org_id too would fail.
    foreignKey({
      name: 'shift_templates_job_role_same_org_fk',
      columns: [t.orgId, t.jobRoleId],
      foreignColumns: [jobRoles.orgId, jobRoles.id],
    }).onDelete('set null'),
    unique('shift_templates_location_name_unique').on(t.locationId, t.name),
    check('shift_templates_times_differ', sql`${t.startTime} <> ${t.endTime}`),
    check('shift_templates_break_range', sql`${t.breakMinutes} between 0 and 240`),
  ],
);

export type ShiftTemplateRow = typeof shiftTemplates.$inferSelect;

export const scheduleStatus = pgEnum('schedule_status', ['draft', 'published']);

/**
 * One location's week (Monday to Sunday in the location's zone). Shifts belong to a schedule;
 * `version` goes up on every change so concurrent editors can detect conflicts.
 * Tenant table (RLS).
 */
export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    orgId: uuid().notNull(),
    locationId: uuid().notNull(),
    /** The local Monday the week starts on. */
    weekStart: date({ mode: 'string' }).notNull(),
    status: scheduleStatus().notNull().default('draft'),
    version: integer().notNull().default(1),
    publishedAt: timestamptz(),
    publishedBy: uuid(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'schedules_location_same_org_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
    unique('schedules_location_week_unique').on(t.locationId, t.weekStart),
    // Target for same-org foreign keys from shifts (W2 D2).
    unique('schedules_org_id_id_unique').on(t.orgId, t.id),
    // A shift must sit in its schedule's location, so the key it references includes it.
    unique('schedules_org_id_id_location_unique').on(t.orgId, t.id, t.locationId),
    check('schedules_week_starts_monday', sql`extract(isodow from ${t.weekStart}) = 1`),
    check(
      'schedules_published_has_time',
      sql`${t.status} <> 'published' or ${t.publishedAt} is not null`,
    ),
    check('schedules_version_positive', sql`${t.version} >= 1`),
  ],
);

export type ScheduleRow = typeof schedules.$inferSelect;
