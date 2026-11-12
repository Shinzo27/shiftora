import { isLocalDate, isWeekStart, nominalMinutes, parseLocalTime } from '@shiftora/domain';
import { z } from 'zod';

import { localTime } from './employees.js';
import type { FieldError } from './problem.js';

const name = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');

/** A calendar date, "YYYY-MM-DD", in the location's time zone. */
export const localDate = z.string().refine(isLocalDate, 'Use a real date as YYYY-MM-DD');
/** The Monday a schedule week starts on (weeks run Monday to Sunday). */
export const weekStart = localDate.refine(isWeekStart, 'A week starts on a Monday');

/** Unpaid break inside a shift, in minutes. */
const breakMinutes = z.number().int().min(0).max(240, 'At most 240 minutes');

// ----------------------------------------------------------------- shift templates

/**
 * The one rule linking start, end and break: start ≠ end (equal would be ambiguous: 0 h or
 * 24 h?) and the break must be shorter than the shift. Used by the create schema and, after
 * merging with the stored row, by updates.
 */
export function shiftTemplateIssue(
  startTime: string,
  endTime: string,
  breakMinutes: number,
): FieldError | null {
  // A malformed time already fails its own field check (Zod still runs this refinement).
  if (parseLocalTime(startTime) === null || parseLocalTime(endTime) === null) return null;
  if (startTime === endTime) return { path: 'endTime', message: 'Must differ from the start' };
  if (breakMinutes >= nominalMinutes(startTime, endTime)) {
    return { path: 'breakMinutes', message: 'The break must be shorter than the shift' };
  }
  return null;
}

/** A reusable shift pattern at one location, e.g. "Morning 07:00–15:00, 30 min break". */
export const shiftTemplate = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  name: z.string(),
  startTime: localTime,
  /** Not after `startTime` = runs overnight into the next day. */
  endTime: localTime,
  breakMinutes: z.number().int(),
  jobRoleId: z.uuid().nullable(),
  /** Wall-clock length minus the break (DST nights differ; shifts store real instants). */
  paidMinutes: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type ShiftTemplate = z.output<typeof shiftTemplate>;

export const createShiftTemplateRequest = z
  .object({
    locationId: z.uuid(),
    name,
    startTime: localTime,
    endTime: localTime,
    breakMinutes: breakMinutes.default(0),
    jobRoleId: z.uuid().nullable().optional(),
  })
  .superRefine((body, ctx) => {
    const issue = shiftTemplateIssue(body.startTime, body.endTime, body.breakMinutes);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  });
export type CreateShiftTemplateRequest = z.output<typeof createShiftTemplateRequest>;

/** The location can't change: templates belong to it. */
export const updateShiftTemplateRequest = z
  .object({
    name: name.optional(),
    startTime: localTime.optional(),
    endTime: localTime.optional(),
    breakMinutes: breakMinutes.optional(),
    jobRoleId: z.uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');
export type UpdateShiftTemplateRequest = z.output<typeof updateShiftTemplateRequest>;

export const listShiftTemplatesQuery = z.object({ locationId: z.uuid().optional() });
export type ListShiftTemplatesQuery = z.output<typeof listShiftTemplatesQuery>;

// ----------------------------------------------------------------------- schedules

export const scheduleStatus = z.enum(['draft', 'published']);
export type ScheduleStatus = z.output<typeof scheduleStatus>;

/** One location's week. Shifts (W2 D2) hang off it; publishing (W2 D5) bumps the version. */
export const schedule = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  weekStart: localDate,
  status: scheduleStatus,
  /** Increases on every change (shifts included) and on each publish. */
  version: z.number().int(),
  /** The version the last publication sent; `version > publishedVersion` = unpublished edits. */
  publishedVersion: z.number().int().nullable(),
  /** The location's zone the week is counted in. */
  timezone: z.string(),
  /** Local Monday 00:00 and the next Monday 00:00, as UTC instants (167–169 h around DST). */
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Schedule = z.output<typeof schedule>;

export const createScheduleRequest = z.object({ locationId: z.uuid(), weekStart });
export type CreateScheduleRequest = z.output<typeof createScheduleRequest>;

export const listSchedulesQuery = z.object({
  locationId: z.uuid(),
  /** Only this week; otherwise the most recent weeks first. */
  weekStart: weekStart.optional(),
});
export type ListSchedulesQuery = z.output<typeof listSchedulesQuery>;
