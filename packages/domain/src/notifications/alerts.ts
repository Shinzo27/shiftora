/**
 * When the worker's minute-by-minute scan sends a shift reminder or a missed clock-in alert.
 * Pure, so the windows can be tested without a clock or a database.
 */

/** A reminder goes out this long before a shift starts (PROJECT_PLAN W4 D5). */
export const REMINDER_LEAD_MINUTES = 120;

/**
 * A missed clock-in is only raised for shifts that started within this many minutes. Older ones
 * are history: the first scan after a deploy (or after the worker was down) must not alert
 * everyone about every shift of the day.
 */
export const MISSED_CLOCK_IN_LOOKBACK_MINUTES = 240;

/** A punch this early still counts as clocking in for the shift (someone who came in early). */
export const EARLY_CLOCK_IN_MINUTES = 120;

const MINUTE = 60_000;

export interface InstantRange {
  /** Exclusive. */
  after: Date;
  /** Inclusive. */
  until: Date;
}

/**
 * Shifts starting in `(now, now + lead]` get a reminder. A shift published less than two hours
 * before it starts still gets one on the next scan, because the window is a range and not
 * "exactly two hours from now" — a missed tick costs nothing.
 */
export function reminderWindow(now: Date, leadMinutes = REMINDER_LEAD_MINUTES): InstantRange {
  return { after: now, until: new Date(now.getTime() + leadMinutes * MINUTE) };
}

/**
 * Shifts that started in `(now − lookback, now − grace]` and have no clock-in yet. The grace is
 * the org's own early/late slack (W3 D4), so "late" means the same thing on the timesheet and in
 * the alert.
 */
export function missedClockInWindow(
  now: Date,
  graceMinutes: number,
  lookbackMinutes = MISSED_CLOCK_IN_LOOKBACK_MINUTES,
): InstantRange {
  return {
    after: new Date(now.getTime() - lookbackMinutes * MINUTE),
    until: new Date(now.getTime() - graceMinutes * MINUTE),
  };
}

/** "in 2 hours", "in 1 hour 35 minutes", "in 20 minutes": how a person says it. */
export function leadLabel(startsAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((startsAt.getTime() - now.getTime()) / MINUTE));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 0 ? '' : `${hours} hour${hours === 1 ? '' : 's'}`;
  const minutePart = rest === 0 ? '' : `${rest} minute${rest === 1 ? '' : 's'}`;
  return `in ${[hourPart, minutePart].filter(Boolean).join(' ')}`;
}
