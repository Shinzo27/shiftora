import { z } from 'zod';

import { localTime } from './employees.js';
import { localDate } from './scheduling.js';

/** A stored instant with an offset: "2026-11-12T09:00:00+05:30" or a `Z` time. */
const instant = z.iso.datetime({ offset: true });

export const attendanceMethod = z.enum(['gps', 'qr', 'manual']);
export type AttendanceMethod = z.output<typeof attendanceMethod>;

/** What an organisation does when someone punches in outside the fence. */
export const geofencePolicy = z.enum(['flag', 'reject']);
export type GeofencePolicy = z.output<typeof geofencePolicy>;

export const attendanceFlag = z.enum(['outside_geofence', 'low_accuracy', 'device_skew']);
export type AttendanceFlag = z.output<typeof attendanceFlag>;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** Horizontal accuracy reported by the device, in metres. */
const accuracyM = z.number().int().min(0).max(100_000);

export const clockInRequest = z.object({
  locationId: z.uuid(),
  /** The shift it belongs to, when the client knows (usually the one starting now). */
  shiftId: z.uuid().nullable().optional(),
  /** The device's clock for the punch. The server keeps its own `receivedAt` as well. */
  at: instant.optional(),
  latitude,
  longitude,
  accuracyM,
  method: attendanceMethod.optional(),
});
export type ClockInRequest = z.output<typeof clockInRequest>;

/** Clocking out may omit coordinates (the app could be offline when it sends the punch). */
export const clockOutRequest = z.object({
  at: instant.optional(),
  latitude: latitude.optional(),
  longitude: longitude.optional(),
  accuracyM: accuracyM.optional(),
});
export type ClockOutRequest = z.output<typeof clockOutRequest>;

/** One worked period as staff and managers see it. */
export const timeEntry = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  shiftId: z.uuid().nullable(),
  clockInAt: z.iso.datetime(),
  clockOutAt: z.iso.datetime().nullable(),
  /** The punch on the location's wall clock, so the app never does zone maths. */
  date: localDate,
  clockInTime: localTime,
  clockOutTime: localTime.nullable(),
  /** Elapsed minutes minus nothing: a break is not deducted here (pay rules take it). */
  minutes: z.number().int(),
  method: attendanceMethod,
  /** Metres from the location as the server measured it. */
  distanceM: z.number().int(),
  accuracyM: z.number().int(),
  flags: z.array(attendanceFlag),
  edited: z.boolean(),
});
export type TimeEntry = z.output<typeof timeEntry>;

/** The answer to a punch: the row, and whether this call created it (idempotent retries). */
export const clockResult = z.object({ entry: timeEntry, created: z.boolean() });
export type ClockResult = z.output<typeof clockResult>;

export const myTimeEntriesQuery = z
  .object({ from: localDate, to: localDate })
  .refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'The end of the range must not be before the start',
  });
export type MyTimeEntriesQuery = z.output<typeof myTimeEntriesQuery>;

export const myTimeEntries = z.object({ items: z.array(timeEntry) });
export type MyTimeEntries = z.output<typeof myTimeEntries>;
