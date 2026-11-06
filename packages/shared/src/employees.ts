import { validateWeeklySlots, type Weekday } from '@shiftora/domain';
import { z } from 'zod';

import { email } from './auth.js';

const name = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');
/** E.164: needed for WhatsApp and SMS. */
const phone = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919812345678');
const minutesPerWeek = z.number().int().min(0).max(10_080);
const restMinutes = z.number().int().min(0).max(2_880);
/** Paise per hour; capped at ₹1,00,000/hour to catch typos. */
const hourlyRateMinor = z.number().int().min(0).max(10_000_000);
const ids = (max: number) => z.array(z.uuid()).max(max);

export const notifyChannel = z.enum(['email', 'whatsapp', 'sms', 'push']);
export const employeeStatus = z.enum(['active', 'archived']);

export const employee = z.object({
  id: z.uuid(),
  userId: z.uuid().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  hourlyRateMinor: z.number().int(),
  currency: z.string(),
  maxWeeklyMinutes: z.number().int().nullable(),
  minRestMinutes: z.number().int().nullable(),
  notifyChannel,
  status: employeeStatus,
  jobRoleIds: z.array(z.uuid()),
  locationIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});
export type Employee = z.output<typeof employee>;

export const createEmployeeRequest = z.object({
  name,
  email: email.nullable().optional(),
  phone: phone.nullable().optional(),
  hourlyRateMinor: hourlyRateMinor.default(0),
  maxWeeklyMinutes: minutesPerWeek.nullable().optional(),
  minRestMinutes: restMinutes.nullable().optional(),
  notifyChannel: notifyChannel.optional(),
  /** Link to a member's login (they must already be in the org). */
  userId: z.uuid().nullable().optional(),
  jobRoleIds: ids(50).optional(),
  locationIds: ids(500).optional(),
});
export type CreateEmployeeRequest = z.output<typeof createEmployeeRequest>;

/** Send only what changes. `jobRoleIds` / `locationIds` replace the whole list. */
export const updateEmployeeRequest = z
  .object({
    name: name.optional(),
    email: email.nullable().optional(),
    phone: phone.nullable().optional(),
    hourlyRateMinor: hourlyRateMinor.optional(),
    maxWeeklyMinutes: minutesPerWeek.nullable().optional(),
    minRestMinutes: restMinutes.nullable().optional(),
    notifyChannel: notifyChannel.optional(),
    userId: z.uuid().nullable().optional(),
    status: employeeStatus.optional(),
    jobRoleIds: ids(50).optional(),
    locationIds: ids(500).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');
export type UpdateEmployeeRequest = z.output<typeof updateEmployeeRequest>;

export const listEmployeesQuery = z.object({
  locationId: z.uuid().optional(),
  status: employeeStatus.default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque value from the previous page's `nextCursor`. */
  cursor: z.string().max(500).optional(),
});
export type ListEmployeesQuery = z.output<typeof listEmployeesQuery>;

/** A page of results. `nextCursor` is null on the last page. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: z.string().nullable() });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** A wall-clock time, "HH:MM" (24-hour). */
export const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export const weeklySlot = z.object({
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: z.number().int().min(1).max(7),
  start: localTime,
  /** Not after `start` = runs overnight into the next day. */
  end: localTime,
});
export type WeeklySlotDto = z.output<typeof weeklySlot>;

/** Replaces the employee's whole weekly pattern. Overlapping slots are rejected. */
export const setAvailabilityRequest = z
  .object({ slots: z.array(weeklySlot).max(50) })
  .superRefine((body, ctx) => {
    const slots = body.slots.map((slot) => ({ ...slot, weekday: slot.weekday as Weekday }));
    for (const issue of validateWeeklySlots(slots)) {
      ctx.addIssue({ code: 'custom', path: ['slots', issue.index], message: issue.message });
    }
  });
export type SetAvailabilityRequest = z.output<typeof setAvailabilityRequest>;

export const availability = z.object({ employeeId: z.uuid(), slots: z.array(weeklySlot) });
export type Availability = z.output<typeof availability>;

/** ISO 8601 with an explicit offset, e.g. 2026-11-10T09:00:00+05:30. */
const instant = z.iso.datetime({ offset: true });
const MAX_TIME_OFF_MS = 366 * 24 * 60 * 60 * 1000;

export const createTimeOffRequest = z
  .object({
    startsAt: instant,
    endsAt: instant,
    reason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((body) => Date.parse(body.endsAt) > Date.parse(body.startsAt), {
    path: ['endsAt'],
    message: 'Must be after startsAt',
  })
  .refine((body) => Date.parse(body.endsAt) - Date.parse(body.startsAt) <= MAX_TIME_OFF_MS, {
    path: ['endsAt'],
    message: 'Time off can be at most 366 days long',
  });
export type CreateTimeOffRequest = z.output<typeof createTimeOffRequest>;

export const timeOffQuery = z.object({ from: instant.optional(), to: instant.optional() });
export type TimeOffQuery = z.output<typeof timeOffQuery>;

export const timeOff = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type TimeOff = z.output<typeof timeOff>;
