import { z } from 'zod';

import { localTime } from './employees.js';

/**
 * Coverage requirements on the wire (W7 D1): "every Monday, this branch needs two nurses from
 * 09:00". The auto-scheduler's input; a manager edits these once, not every week.
 */

const weekday = z.number().int().min(1, 'Monday is 1').max(7, 'Sunday is 7');
const headcount = z.number().int().min(1).max(20);

export const createCoverageRequirement = z
  .object({
    weekday,
    /** Null (or absent) means anyone at the branch may fill it. */
    jobRoleId: z.uuid().nullable().optional(),
    startLocal: localTime,
    endLocal: localTime,
    headcount: headcount.default(1),
  })
  .refine((body) => body.startLocal !== body.endLocal, {
    path: ['endLocal'],
    message: 'Start and end cannot be the same time',
  });
export type CreateCoverageRequirement = z.output<typeof createCoverageRequirement>;

/** Every field optional: a manager changes one row's hours without re-sending the rest. */
export const updateCoverageRequirement = z
  .object({
    weekday: weekday.optional(),
    jobRoleId: z.uuid().nullable().optional(),
    startLocal: localTime.optional(),
    endLocal: localTime.optional(),
    headcount: headcount.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to change' });
export type UpdateCoverageRequirement = z.output<typeof updateCoverageRequirement>;

export const coverageRequirementView = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  weekday,
  jobRoleId: z.uuid().nullable(),
  /** Resolved for the UI so a table does not need a second request per row. */
  jobRoleName: z.string().nullable(),
  startLocal: z.string(),
  endLocal: z.string(),
  headcount,
});
export type CoverageRequirementView = z.output<typeof coverageRequirementView>;
