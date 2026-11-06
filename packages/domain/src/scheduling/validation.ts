import { parseLocalTime } from '../availability/weekly.js';
import { dayOfWeek, toLocal, type Interval, type LocalTime } from '../time/zoned.js';

/**
 * Conflict checks for a shift, as pure functions.
 *
 * A manager places a shift on a date at a location; these functions answer "what is wrong with
 * this shift for this employee?" without touching the database, a clock or a time zone lookup
 * of their own: instants come in as `Date`s and local wall-clock values are passed in.
 *
 * Two families of problem:
 * - **Overlap** is a hard error: an employee cannot be in two places at once. The database
 *   enforces it too (exclusion constraint on `shifts`), this is the friendly error.
 * - **Availability, time off, max weekly hours and min rest** are warnings: the manager may
 *   still have a reason (a nurse covering a colleague's leave), so they are shown, not blocked.
 */

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A span of real time. `endsAt` is exclusive: 09:00–17:00 and 17:00–23:00 do not overlap. */
export interface ShiftSpan {
  startsAt: Date;
  endsAt: Date;
}

/** A shift as the checks see it: instants, the unpaid break inside them, and its id. */
export interface ShiftHours extends ShiftSpan {
  breakMinutes: number;
  id?: string;
}

/** A recurring weekly window in local wall-clock time (see `availability/weekly.ts`). */
export interface AvailabilitySlot {
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
  start: LocalTime;
  end: LocalTime;
}

export interface TimeOffPeriod {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

export type ShiftWarningCode =
  'overlap' | 'unavailable' | 'time_off' | 'max_weekly_hours' | 'min_rest';

export interface ShiftWarning {
  code: ShiftWarningCode;
  /** Ready to show to a manager, e.g. "Not available Tue 18:00–22:00". */
  message: string;
  /** The other shift involved (an overlap or the shift that leaves too little rest). */
  shiftId?: string;
}

export interface ShiftValidationInput {
  /** The shift being created or changed, with its local weekday and wall-clock times. */
  candidate: ShiftHours & { weekday: number; startTime: LocalTime; endTime: LocalTime };
  /** The zone of the location the shift is at: used to phrase messages, not to compute. */
  timezone: string;
  /** The schedule's week as UTC instants (Monday 00:00 to the next Monday, local). */
  week: Interval;
  /** The employee's recurring availability; empty = nothing recorded, so no warning. */
  availability: readonly AvailabilitySlot[];
  timeOff: readonly TimeOffPeriod[];
  /** The employee's other shifts (cancelled ones excluded), at least around the candidate. */
  otherShifts: readonly ShiftHours[];
  maxWeeklyMinutes: number | null;
  minRestMinutes: number | null;
}

// ------------------------------------------------------------------------ intervals

/** Half-open overlap: shifts that merely touch (17:00 end, 17:00 start) don't conflict. */
export function spansOverlap(a: ShiftSpan, b: ShiftSpan): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

/** Paid minutes: real elapsed time minus the unpaid break, never negative. */
export function paidMinutes(shift: ShiftHours): number {
  const elapsed = (shift.endsAt.getTime() - shift.startsAt.getTime()) / MINUTE_MS;
  return Math.max(0, elapsed - shift.breakMinutes);
}

export function totalPaidMinutes(shifts: readonly ShiftHours[]): number {
  return shifts.reduce((sum, shift) => sum + paidMinutes(shift), 0);
}

// ----------------------------------------------------------------------- formatting

function clock(minutes: number): { weekday: number; time: string } {
  const wrapped = ((minutes % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK;
  const inDay = wrapped % MINUTES_PER_DAY;
  return {
    weekday: Math.floor(wrapped / MINUTES_PER_DAY) + 1,
    time: `${String(Math.floor(inDay / 60)).padStart(2, '0')}:${String(inDay % 60).padStart(2, '0')}`,
  };
}

/** "Tue 22:00–Wed 02:00" (minutes since Monday 00:00, may run past a week). */
function describeWeekMinutes(from: number, to: number): string {
  const start = clock(from);
  const end = clock(to);
  const endLabel =
    end.weekday === start.weekday ? end.time : `${DAY_NAMES[end.weekday - 1]!} ${end.time}`;
  return `${DAY_NAMES[start.weekday - 1]!} ${start.time}–${endLabel}`;
}

/** "Tue 15:00–23:00" for a real instant, in the location's zone. */
function describeInstantSpan(shift: ShiftSpan, timezone: string): string {
  const from = toLocal(shift.startsAt, timezone);
  const to = toLocal(shift.endsAt, timezone);
  const fromDay = DAY_NAMES[dayOfWeek(from.date) - 1]!;
  const toDay = DAY_NAMES[dayOfWeek(to.date) - 1]!;
  return toDay === fromDay
    ? `${fromDay} ${from.time}–${to.time}`
    : `${fromDay} ${from.time}–${toDay} ${to.time}`;
}

/** "7 h 30 m", "45 m", "8 h". Hours and minutes only: never days. */
export function formatMinutes(minutes: number): string {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest} m`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

// -------------------------------------------------------------------------- overlap

export function overlapWarnings(
  candidate: ShiftSpan,
  otherShifts: readonly ShiftHours[],
  timezone: string,
): ShiftWarning[] {
  return otherShifts
    .filter((other) => spansOverlap(candidate, other))
    .map((other) => ({
      code: 'overlap' as const,
      message: `Already working ${describeInstantSpan(other, timezone)}`,
      ...(other.id ? { shiftId: other.id } : {}),
    }));
}

// ----------------------------------------------------------------------- time off

export function timeOffWarnings(
  candidate: ShiftSpan,
  periods: readonly TimeOffPeriod[],
  timezone: string,
): ShiftWarning[] {
  return periods
    .filter((period) => spansOverlap(candidate, period))
    .map((period) => ({
      code: 'time_off' as const,
      message: `Time off is booked ${describeInstantSpan(period, timezone)}`,
    }));
}

// --------------------------------------------------------------------- availability

/** The slot as [start, end) minutes since Monday 00:00; overnight slots pass midnight. */
function slotSpan(slot: AvailabilitySlot): [number, number] | null {
  const start = parseLocalTime(slot.start);
  const end = parseLocalTime(slot.end);
  if (start === null || end === null || start === end) return null;
  const dayStart = (slot.weekday - 1) * MINUTES_PER_DAY;
  return [dayStart + start, dayStart + end + (end < start ? MINUTES_PER_DAY : 0)];
}

/** The shift as [start, end) minutes since Monday 00:00. `end <= start` runs overnight. */
function shiftSpan(
  weekday: number,
  startTime: LocalTime,
  endTime: LocalTime,
): [number, number] | null {
  const start = parseLocalTime(startTime);
  const end = parseLocalTime(endTime);
  if (start === null || end === null || start === end) return null;
  const dayStart = (weekday - 1) * MINUTES_PER_DAY;
  return [dayStart + start, dayStart + end + (end < start ? MINUTES_PER_DAY : 0)];
}

/** [start, end) minutes since Monday 00:00. */
type MinuteRange = [number, number];

function mergeIntervals(intervals: readonly MinuteRange[]): MinuteRange[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: MinuteRange[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval] as MinuteRange);
  }
  return merged;
}

/** `from` minus `cut`: the pieces of `from` not covered by `cut`. */
function subtract(from: MinuteRange, [cutStart, cutEnd]: MinuteRange): MinuteRange[] {
  if (cutEnd <= from[0] || cutStart >= from[1]) return [from];
  const pieces: MinuteRange[] = [];
  if (from[0] < cutStart) pieces.push([from[0], cutStart]);
  if (cutEnd < from[1]) pieces.push([cutEnd, from[1]]);
  return pieces;
}

/**
 * The parts of a week-long interval that no slot covers.
 *
 * Slots are repeated into the neighbouring week (Sunday 22:00–06:00 covers Monday morning)
 * so a shift is only ever compared against the seven days around it.
 */
export function uncoveredParts(
  span: MinuteRange,
  slots: readonly AvailabilitySlot[],
): MinuteRange[] {
  const expanded = slots.flatMap((slot) => {
    const interval = slotSpan(slot);
    if (!interval) return [];
    return [
      [interval[0] - MINUTES_PER_WEEK, interval[1] - MINUTES_PER_WEEK] as MinuteRange,
      interval,
      [interval[0] + MINUTES_PER_WEEK, interval[1] + MINUTES_PER_WEEK] as MinuteRange,
    ];
  });
  let gaps: MinuteRange[] = [span];
  for (const covered of mergeIntervals(expanded)) {
    gaps = gaps.flatMap((gap) => subtract(gap, covered));
  }
  return gaps;
}

/**
 * Availability is a weekly pattern in the location's wall-clock time, so an overnight slot
 * (Fri 22:00–06:00) covers Saturday's early hours, and a Sunday-night slot covers Monday.
 * No slots recorded = no restriction (the employee hasn't filled their availability in yet).
 */
export function availabilityWarnings(
  shift: { weekday: number; startTime: LocalTime; endTime: LocalTime },
  slots: readonly AvailabilitySlot[],
): ShiftWarning[] {
  if (slots.length === 0) return [];
  const span = shiftSpan(shift.weekday, shift.startTime, shift.endTime);
  if (!span) return [];
  return uncoveredParts(span, slots).map(([from, to]) => ({
    code: 'unavailable' as const,
    message: `Not available ${describeWeekMinutes(from, to)}`,
  }));
}

// ---------------------------------------------------------------- weekly hour cap

export function maxWeeklyHoursWarnings(
  candidate: ShiftHours,
  otherShifts: readonly ShiftHours[],
  week: Interval,
  maxWeeklyMinutes: number | null,
): ShiftWarning[] {
  if (maxWeeklyMinutes === null) return [];
  // A shift belongs to the week its start falls in (ARCHITECTURE.md §7.2).
  const inWeek = otherShifts.filter(
    (other) =>
      other.startsAt.getTime() >= week.start.getTime() &&
      other.startsAt.getTime() < week.end.getTime(),
  );
  const total = totalPaidMinutes([...inWeek, candidate]);
  if (total <= maxWeeklyMinutes) return [];
  return [
    {
      code: 'max_weekly_hours',
      message: `This week would be ${formatMinutes(total)} (limit ${formatMinutes(maxWeeklyMinutes)})`,
    },
  ];
}

// ---------------------------------------------------------------------------- rest

export function minRestWarnings(
  candidate: ShiftSpan,
  otherShifts: readonly ShiftHours[],
  minRestMinutes: number | null,
  timezone: string,
): ShiftWarning[] {
  if (minRestMinutes === null) return [];
  const warnings: ShiftWarning[] = [];
  for (const other of [...otherShifts].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime(),
  )) {
    if (spansOverlap(candidate, other)) continue; // reported as an overlap
    const gap =
      candidate.startsAt.getTime() >= other.endsAt.getTime()
        ? (candidate.startsAt.getTime() - other.endsAt.getTime()) / MINUTE_MS
        : (other.startsAt.getTime() - candidate.endsAt.getTime()) / MINUTE_MS;
    if (gap < minRestMinutes) {
      warnings.push({
        code: 'min_rest',
        message: `Only ${formatMinutes(gap)} rest around the shift ${describeInstantSpan(other, timezone)} (needs ${formatMinutes(minRestMinutes)})`,
        ...(other.id ? { shiftId: other.id } : {}),
      });
    }
  }
  return warnings;
}

// ------------------------------------------------------------------------- entry point

/**
 * Every problem with placing `candidate` for this employee, in a stable order:
 * overlap, time off, availability, weekly hours, rest.
 */
export function validateShift(input: ShiftValidationInput): ShiftWarning[] {
  return [
    ...overlapWarnings(input.candidate, input.otherShifts, input.timezone),
    ...timeOffWarnings(input.candidate, input.timeOff, input.timezone),
    ...availabilityWarnings(input.candidate, input.availability),
    ...maxWeeklyHoursWarnings(
      input.candidate,
      input.otherShifts,
      input.week,
      input.maxWeeklyMinutes,
    ),
    ...minRestWarnings(input.candidate, input.otherShifts, input.minRestMinutes, input.timezone),
  ];
}
