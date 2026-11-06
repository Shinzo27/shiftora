import { parseLocalTime } from '../availability/weekly.js';

/**
 * Local wall-clock dates and times in a location's IANA time zone, converted to and from UTC
 * instants. Built on the platform's Temporal API (Node 26), which applies the IANA rules,
 * so daylight-saving changes are handled by the spec rather than by our own arithmetic.
 *
 * Inputs and outputs are plain values ("2026-11-10", "09:00", Date) so callers never need
 * Temporal types. Invalid input throws a RangeError rather than being guessed at.
 */

/** A calendar date with no time zone, "YYYY-MM-DD". */
export type LocalDate = string;
/** A wall-clock time, "HH:MM" (24-hour). */
export type LocalTime = string;

export interface Interval {
  /** Inclusive. */
  start: Date;
  /** Exclusive. */
  end: Date;
}

/** Weeks start on Monday (ISO 8601) everywhere for now; a per-org setting can come later. */
export const WEEK_STARTS_ON = 1;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTES_PER_DAY = 24 * 60;

function plainDate(date: LocalDate): Temporal.PlainDate {
  if (!DATE.test(date)) throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}"`);
  return Temporal.PlainDate.from(date); // throws RangeError for impossible dates (2026-02-30)
}

function minutesOf(time: LocalTime): number {
  const minutes = parseLocalTime(time);
  if (minutes === null) throw new RangeError(`Expected an HH:MM time, got "${time}"`);
  return minutes;
}

/** Midnight at the start of `date` in `zone` (or the first moment of the day, if a DST
 *  change skips midnight, as happens in a few zones). */
function startOfDay(date: LocalDate, zone: string): Date {
  return new Date(plainDate(date).toZonedDateTime(zone).epochMilliseconds);
}

export function isLocalDate(value: string): boolean {
  try {
    plainDate(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return plainDate(date).add({ days }).toString();
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function dayOfWeek(date: LocalDate): number {
  return plainDate(date).dayOfWeek;
}

/** The Monday on or before `date`. */
export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, -((dayOfWeek(date) - WEEK_STARTS_ON + 7) % 7));
}

export function isWeekStart(date: LocalDate): boolean {
  return isLocalDate(date) && dayOfWeek(date) === WEEK_STARTS_ON;
}

/** The seven dates of the week starting on `weekStart`. */
export function weekDates(weekStart: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/**
 * The UTC instant of a local date and time in `zone`.
 *
 * Daylight saving ("compatible" disambiguation, as in RFC 5545 and Temporal's default):
 * - A time skipped by spring-forward moves forward by the gap (London 01:30 → 02:30 BST).
 * - A time repeated by fall-back means its first occurrence (the earlier instant).
 */
export function toInstant(date: LocalDate, time: LocalTime, zone: string): Date {
  const day = plainDate(date);
  const minutes = minutesOf(time);
  const zoned = Temporal.ZonedDateTime.from(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      timeZone: zone,
    },
    { disambiguation: 'compatible' },
  );
  return new Date(zoned.epochMilliseconds);
}

/** The local date and time (to the minute) that `instant` shows on a clock in `zone`. */
export function toLocal(instant: Date, zone: string): { date: LocalDate; time: LocalTime } {
  const zoned = Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(zone);
  return {
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

/** A local calendar day as UTC instants: 24 h normally, 23 h or 25 h on DST-change days. */
export function localDayBounds(date: LocalDate, zone: string): Interval {
  return { start: startOfDay(date, zone), end: startOfDay(addDays(date, 1), zone) };
}

/** A schedule week (Monday 00:00 to the next Monday 00:00, local) as UTC instants. */
export function weekBounds(weekStart: LocalDate, zone: string): Interval {
  if (!isWeekStart(weekStart)) {
    throw new RangeError(`A week starts on a Monday; "${weekStart}" is not one`);
  }
  return { start: startOfDay(weekStart, zone), end: startOfDay(addDays(weekStart, 7), zone) };
}

/**
 * A shift worked on local `date` from `start` to `end` in `zone`. If `end` is not after
 * `start` the shift runs overnight and ends on the next day. `minutes` is the real elapsed
 * time, so a 22:00–06:00 night shift is 7 h or 9 h when the clocks change during it.
 */
export function shiftTimes(
  date: LocalDate,
  start: LocalTime,
  end: LocalTime,
  zone: string,
): { startsAt: Date; endsAt: Date; minutes: number } {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === to) throw new RangeError('A shift must end at a different time than it starts');
  const startsAt = toInstant(date, start, zone);
  const endsAt = toInstant(to < from ? addDays(date, 1) : date, end, zone);
  return { startsAt, endsAt, minutes: (endsAt.getTime() - startsAt.getTime()) / 60_000 };
}

/**
 * Length of a start–end pair on the wall clock, ignoring daylight saving (e.g. a template's
 * "8 h"). Overnight pairs wrap past midnight. For real worked time use `shiftTimes`.
 */
export function nominalMinutes(start: LocalTime, end: LocalTime): number {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === to) throw new RangeError('Start and end must differ');
  return (to - from + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}
