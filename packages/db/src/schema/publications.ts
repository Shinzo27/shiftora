import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, jsonb, pgTable, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { schedules } from './scheduling.js';

/**
 * The shape stored in `shifts`: what one shift looked like when the week was sent out.
 * Declared here so the table is self-describing; the API validates reads with the shared
 * Zod schema before trusting them.
 */
export interface PublishedShiftJson {
  shiftId: string;
  employeeId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  jobRoleId: string | null;
}

/**
 * One row per "Publish": the snapshot staff were actually told about, and who it concerned.
 *
 * Why a table and not a flag on the schedule: the next publish needs to know what the last one
 * said (to diff), the notification worker needs the audience, and "who was told what, when" is
 * exactly the question a manager asks after a mix-up. Tenant table (RLS).
 */
export const schedulePublications = pgTable(
  'schedule_publications',
  {
    id: id(),
    orgId: uuid().notNull(),
    scheduleId: uuid().notNull(),
    /** The schedule version this publication sent. */
    version: integer().notNull(),
    /** Every shift in the week at publish time (open ones included, cancelled ones excluded). */
    shifts: jsonb().$type<PublishedShiftJson[]>().notNull(),
    /** Employees whose week differs from the previous publication; the notification audience. */
    affectedEmployeeIds: uuid().array().notNull(),
    publishedBy: uuid(),
    publishedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'schedule_publications_schedule_fk',
      columns: [t.orgId, t.scheduleId],
      foreignColumns: [schedules.orgId, schedules.id],
    }).onDelete('cascade'),
    index('schedule_publications_schedule_idx').on(t.scheduleId, t.publishedAt),
    check('schedule_publications_version_positive', sql`${t.version} >= 1`),
  ],
);

export type SchedulePublicationRow = typeof schedulePublications.$inferSelect;
