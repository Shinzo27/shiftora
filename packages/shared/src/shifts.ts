import { z } from 'zod';

import { localTime } from './employees.js';
import { localDate, shiftTemplateIssue } from './scheduling.js';

/** An open shift has no assignee yet; cancelling keeps the row for history. */
export const shiftStatus = z.enum(['open', 'assigned', 'cancelled']);
export type ShiftStatus = z.output<typeof shiftStatus>;

/** Why a shift conflicts with the employee's constraints. `overlap` blocks the write. */
export const shiftWarningCode = z.enum([
  'overlap',
  'unavailable',
  'time_off',
  'max_weekly_hours',
  'min_rest',
]);
export type ShiftWarningCode = z.output<typeof shiftWarningCode>;

export const shiftWarning = z.object({
  code: shiftWarningCode,
  /** Ready to show to a manager, e.g. "Not available Tue 18:00–22:00". */
  message: z.string(),
  /** The other shift involved: the one it overlaps, or the one that leaves too little rest. */
  shiftId: z.uuid().optional(),
});
export type ShiftWarning = z.output<typeof shiftWarning>;

const breakMinutes = z.number().int().min(0).max(240, 'At most 240 minutes');
const notes = z.string().trim().max(500, 'At most 500 characters');

/**
 * A shift on one location's week. Instants are the truth; `date`, `startTime` and `endTime`
 * are the same shift on the location's wall clock, so the client never does time zone maths.
 * An `endTime` not after `startTime` runs overnight into the next day.
 */
export const shift = z.object({
  id: z.uuid(),
  scheduleId: z.uuid(),
  locationId: z.uuid(),
  /** Null = no particular role (a shift from a template without one). */
  jobRoleId: z.uuid().nullable(),
  /** Null = open shift, nobody assigned yet. */
  employeeId: z.uuid().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  date: localDate,
  startTime: localTime,
  endTime: localTime,
  breakMinutes: z.number().int(),
  /** Real elapsed time minus the break: 7 h for a DST night that clocks 8. */
  paidMinutes: z.number().int(),
  status: shiftStatus,
  /** Increases on every change; send it back to detect a concurrent edit. */
  version: z.number().int(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Shift = z.output<typeof shift>;

export const createShiftRequest = z
  .object({
    scheduleId: z.uuid(),
    /** Omit or null to leave the shift open for staff to pick up (W5). */
    employeeId: z.uuid().nullable().optional(),
    jobRoleId: z.uuid().nullable().optional(),
    date: localDate,
    startTime: localTime,
    endTime: localTime,
    breakMinutes: breakMinutes.default(0),
    notes: notes.nullable().optional(),
  })
  .superRefine((body, ctx) => {
    // Same rule as templates: start ≠ end, and the break must be shorter than the shift.
    const issue = shiftTemplateIssue(body.startTime, body.endTime, body.breakMinutes);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
export type CreateShiftRequest = z.output<typeof createShiftRequest>;

/**
 * Send only what changes. A shift never moves to another schedule: another week or location
 * means another schedule, so that is a new shift. `version` is optional but recommended:
 * a stale value is a 409 instead of overwriting someone else's edit.
 */
export const updateShiftRequest = z
  .object({
    date: localDate.optional(),
    startTime: localTime.optional(),
    endTime: localTime.optional(),
    breakMinutes: breakMinutes.optional(),
    employeeId: z.uuid().nullable().optional(),
    jobRoleId: z.uuid().nullable().optional(),
    notes: notes.nullable().optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine(
    (body) => Object.keys(body).some((key) => key !== 'version'),
    'Send at least one field to change',
  );
export type UpdateShiftRequest = z.output<typeof updateShiftRequest>;

export const listShiftsQuery = z.object({ scheduleId: z.uuid() });
export type ListShiftsQuery = z.output<typeof listShiftsQuery>;

/**
 * What a write returns: the stored shift plus the conflict warnings the manager should see.
 * Warnings never block the write (only `overlap` does, as a 409).
 */
export const shiftWriteResult = z.object({ shift, warnings: z.array(shiftWarning) });
export type ShiftWriteResult = z.output<typeof shiftWriteResult>;

/** The advisories attached to one shift on the board (only shifts that have any are listed). */
export const shiftConflict = z.object({
  shiftId: z.uuid(),
  warnings: z.array(shiftWarning),
});
export type ShiftConflict = z.output<typeof shiftConflict>;

/** A week's conflicts in one request, so the board can badge shifts without a call per shift. */
export const scheduleConflicts = z.object({
  scheduleId: z.uuid(),
  conflicts: z.array(shiftConflict),
});
export type ScheduleConflicts = z.output<typeof scheduleConflicts>;
