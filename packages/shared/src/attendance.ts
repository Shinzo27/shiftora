import { z } from 'zod';

import { localTime } from './employees.js';
import { localDate } from './scheduling.js';

/** A stored instant with an offset: "2026-11-12T09:00:00+05:30" or a `Z` time. */
const instant = z.iso.datetime({ offset: true });

export const attendanceMethod = z.enum(['gps', 'qr', 'manual']);
export type AttendanceMethod = z.output<typeof attendanceMethod>;

/** What an organisation does when someone punches in outside the location's radius. */
export const geofencePolicy = z.enum(['flag', 'reject']);
export type GeofencePolicy = z.output<typeof geofencePolicy>;

export const attendanceFlag = z.enum(['outside_geofence', 'low_accuracy', 'device_skew']);
export type AttendanceFlag = z.output<typeof attendanceFlag>;

/** How a punch compares with the shift it was matched to. */
export const punchState = z.enum(['on_time', 'early', 'late', 'unscheduled']);
export type PunchState = z.output<typeof punchState>;

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

/** The shift a punch was matched to, in the words a manager reads: 09:00–17:00. */
export const matchedShift = z.object({
  id: z.uuid(),
  startTime: localTime,
  endTime: localTime,
});
export type MatchedShift = z.output<typeof matchedShift>;

/** One worked period as staff and managers see it. */
export const timeEntry = z.object({
  id: z.uuid(),
  employeeId: z.uuid(),
  locationId: z.uuid(),
  locationName: z.string(),
  shiftId: z.uuid().nullable(),
  /** Null when nobody was rostered then: an extra shift still gets recorded. */
  shift: matchedShift.nullable(),
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
  /** Against the matched shift, beyond the organisation's grace: 0 when on time. */
  lateMinutes: z.number().int(),
  earlyMinutes: z.number().int(),
  state: punchState,
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

/** A manager's view of one punch: the entry, plus whose it is. */
export const attendanceRow = timeEntry.extend({ employeeName: z.string() });
export type AttendanceRow = z.output<typeof attendanceRow>;

export const attendanceQuery = z
  .object({ locationId: z.uuid(), from: localDate, to: localDate })
  .refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'The end of the range must not be before the start',
  });
export type AttendanceQuery = z.output<typeof attendanceQuery>;

/** The range's punches, plus the per-employee totals a timesheet prints. */
export const attendance = z.object({
  locationId: z.uuid(),
  locationName: z.string(),
  from: localDate,
  to: localDate,
  items: z.array(attendanceRow),
  totals: z.array(
    z.object({
      employeeId: z.uuid(),
      employeeName: z.string(),
      /** Minutes actually worked in the range; an open punch counts up to now. */
      workedMinutes: z.number().int(),
      /** Minutes rostered for that person in the same range. */
      plannedMinutes: z.number().int(),
    }),
  ),
});
export type Attendance = z.output<typeof attendance>;

/** A manager's correction: what changed, and why. Both end up in the audit trail. */
/**
 * A correction, in the location's own wall clock — the same shape a shift has, so a manager
 * types what the wall says and the server does the zone arithmetic. A clock-out earlier than
 * the clock-in is read as the next morning (an overnight shift), not as a typo.
 */
export const updateTimeEntryRequest = z
  .object({
    /** The day the punch belongs to. Defaults to the day it is already on. */
    date: localDate.optional(),
    clockInTime: localTime.optional(),
    clockOutTime: localTime.nullable().optional(),
    reason: z.string().trim().min(3, 'Say why, in a few words').max(300),
  })
  .refine(
    (body) =>
      body.clockInTime !== undefined || body.clockOutTime !== undefined || body.date !== undefined,
    { message: 'Send the time that changed' },
  );
export type UpdateTimeEntryRequest = z.output<typeof updateTimeEntryRequest>;

/** One correction, read back from the audit trail: what it was, what it became, and why. */
export const timeEntryEdit = z.object({
  at: z.iso.datetime(),
  by: z.string().nullable(),
  reason: z.string().nullable(),
  before: z.object({
    clockInAt: z.iso.datetime().nullable(),
    clockOutAt: z.iso.datetime().nullable(),
  }),
  after: z.object({
    clockInAt: z.iso.datetime().nullable(),
    clockOutAt: z.iso.datetime().nullable(),
  }),
});
export type TimeEntryEdit = z.output<typeof timeEntryEdit>;

export const timeEntryWithEdits = z.object({
  entry: attendanceRow,
  edits: z.array(timeEntryEdit),
});
export type TimeEntryWithEdits = z.output<typeof timeEntryWithEdits>;
