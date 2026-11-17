import { addDays, startOfWeek, type LocalDate } from '../time/zoned.js';
import type { PayLine } from './compute.js';

/**
 * Pay periods (W6 D4). A period is a run of local dates a manager picks — at most 31, never
 * overlapping another (owner's decision: dates, not a fixed cycle).
 */
export const MAX_PERIOD_DAYS = 31;

/** Days in [startsOn, endsOn], both inclusive. */
export function periodDays(startsOn: LocalDate, endsOn: LocalDate): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}

/**
 * Which work to load to price a period correctly, and which lines to keep.
 *
 * - Weekly overtime needs the whole week: a period starting on a Thursday must count Monday to
 *   Wednesday's minutes toward that week's threshold (they were paid in the previous period, at
 *   whatever rate applied then; here they only move the threshold).
 * - An overnight shift that clocked in the evening before the period belongs, after midnight,
 *   to the period's first day.
 *
 * So load from the day before the week of `startsOn`, compute everything, and keep only the
 * lines dated inside the period. Each minute is then paid in exactly one period.
 */
export function payWindow(
  startsOn: LocalDate,
  endsOn: LocalDate,
): { loadFrom: LocalDate; loadTo: LocalDate } {
  return { loadFrom: addDays(startOfWeek(startsOn), -1), loadTo: endsOn };
}

export function linesInPeriod(
  lines: readonly PayLine[],
  startsOn: LocalDate,
  endsOn: LocalDate,
): PayLine[] {
  return lines.filter((line) => line.date >= startsOn && line.date <= endsOn);
}
