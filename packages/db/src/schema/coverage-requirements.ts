import { sql } from 'drizzle-orm';
import { check, foreignKey, integer, pgTable, time, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { id, timestamptz } from './columns.js';
import { jobRoles } from './job-roles.js';
import { locations } from './locations.js';
import { organizations } from './organizations.js';

/**
 * "Every Monday, this branch needs two nurses from 09:00."
 *
 * The input to the auto-scheduler (W7): a standing requirement, not a shift. It says how many
 * people the branch needs, in which role (or any role), and when — and the solver turns a week of
 * these into draft shifts it can justify.
 *
 * Weekday templates rather than dated rows, because that is how a clinic is staffed: the pattern
 * repeats until someone changes it. A date-specific override is a later feature and would not
 * change what this row means.
 */
export const coverageRequirements = pgTable(
  'coverage_requirements',
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    locationId: uuid().notNull(),
    /** ISO weekday: 1 = Monday … 7 = Sunday, the numbering `availability` already uses. */
    weekday: integer().notNull(),
    /** Null means "anyone at this branch": a small clinic staffs a location, not a role. */
    jobRoleId: uuid(),
    startLocal: time().notNull(),
    endLocal: time().notNull(),
    /** How many people are needed at once. The solver fills this many slots, not one. */
    headcount: integer().notNull().default(1),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'coverage_requirements_location_fk',
      columns: [t.orgId, t.locationId],
      foreignColumns: [locations.orgId, locations.id],
    }).onDelete('cascade'),
    // Setting a role to null is the point of the column, so deleting a role clears it rather than
    // taking the requirement with it.
    foreignKey({
      name: 'coverage_requirements_role_fk',
      columns: [t.orgId, t.jobRoleId],
      foreignColumns: [jobRoles.orgId, jobRoles.id],
    }).onDelete('cascade'),
    check('coverage_requirements_weekday_range', sql`${t.weekday} between 1 and 7`),
    check('coverage_requirements_headcount_range', sql`${t.headcount} between 1 and 20`),
    check('coverage_requirements_times_differ', sql`${t.startLocal} <> ${t.endLocal}`),
    // One row per (branch, weekday, start, role): two identical requirements would double the
    // headcount by accident, which is exactly the kind of quiet bug the database should refuse.
    uniqueIndex('coverage_requirements_unique').on(
      t.orgId,
      t.locationId,
      t.weekday,
      t.startLocal,
      t.jobRoleId,
    ),
  ],
);

export type CoverageRequirementRow = typeof coverageRequirements.$inferSelect;
