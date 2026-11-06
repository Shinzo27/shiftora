/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * A recurring weekly window in LOCAL wall-clock time ("HH:MM"), e.g. Mon 09:00–17:00.
 * If `end` is not after `start` the window runs overnight into the next day
 * (Fri 22:00–06:00 ends Saturday 06:00). Local times are interpreted in the time zone of
 * the location a shift is at, so the same pattern works for every location.
 */
export interface WeeklySlot {
  weekday: Weekday;
  start: string;
  end: string;
}

export interface SlotIssue {
  /** Index of the offending slot in the input array. */
  index: number;
  message: string;
}

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseLocalTime(value: string): number | null {
  const match = HH_MM.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** The slot as [start, end) minutes since Monday 00:00; overnight slots extend past the day. */
function toWeekMinutes(slot: WeeklySlot): [number, number] | null {
  const start = parseLocalTime(slot.start);
  const end = parseLocalTime(slot.end);
  if (start === null || end === null || start === end) return null;
  const dayStart = (slot.weekday - 1) * MINUTES_PER_DAY;
  return [dayStart + start, dayStart + end + (end < start ? MINUTES_PER_DAY : 0)];
}

/** Intervals overlap on the weekly circle (Sunday night runs into Monday morning). */
function overlaps([a1, a2]: [number, number], [b1, b2]: [number, number]): boolean {
  for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
    if (a1 < b2 + shift && b1 + shift < a2) return true;
  }
  return false;
}

/**
 * Checks a weekly availability pattern. Returns every problem found (empty = valid):
 * bad times, zero-length slots, and slots that overlap (including overnight slots that
 * spill into the next day, and Sunday night into Monday).
 */
export function validateWeeklySlots(slots: readonly WeeklySlot[]): SlotIssue[] {
  const issues: SlotIssue[] = [];
  const intervals: ([number, number] | null)[] = slots.map(toWeekMinutes);

  intervals.forEach((interval, index) => {
    if (!interval) {
      issues.push({ index, message: 'Use HH:MM times, and start and end must differ' });
    }
  });

  for (let i = 0; i < intervals.length; i += 1) {
    for (let j = i + 1; j < intervals.length; j += 1) {
      const a = intervals[i];
      const b = intervals[j];
      if (a && b && overlaps(a, b)) {
        issues.push({ index: j, message: `Overlaps slot ${i + 1}` });
      }
    }
  }
  return issues;
}
