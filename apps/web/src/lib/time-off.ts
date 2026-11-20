import { addDays, localDayBounds, toLocal, type LocalDate } from '@shiftora/domain';

/**
 * Time off as a manager enters it (W7½ UI2): whole days on the branch's calendar. The API stores
 * instants, so "12 to 14 December" becomes local midnight on the 12th up to local midnight after
 * the 14th, in the branch's zone — correct across a DST change, which hour arithmetic is not.
 */

/** ISO weekday (1 = Monday) → name, in the order a week is shown. */
export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export function dayRange(
  firstDay: LocalDate,
  lastDay: LocalDate,
  zone: string,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: localDayBounds(firstDay, zone).start.toISOString(),
    endsAt: localDayBounds(lastDay, zone).end.toISOString(),
  };
}

const dayMonth = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const label = (date: LocalDate) => dayMonth.format(new Date(`${date}T00:00:00Z`));

/**
 * "12 Dec", "12 Dec – 14 Dec", or with times when it does not start and end at midnight
 * ("12 Dec 14:00 – 13 Dec 09:00"), read on the branch's calendar.
 */
export function timeOffLabel(item: { startsAt: string; endsAt: string }, zone: string): string {
  const start = toLocal(new Date(item.startsAt), zone);
  const end = toLocal(new Date(item.endsAt), zone);
  const wholeDays = start.time === '00:00' && end.time === '00:00';
  if (wholeDays) {
    const lastDay = addDays(end.date, -1);
    return lastDay === start.date ? label(start.date) : `${label(start.date)} – ${label(lastDay)}`;
  }
  return `${label(start.date)} ${start.time} – ${label(end.date)} ${end.time}`;
}
