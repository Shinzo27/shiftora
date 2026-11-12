import { dayOfWeek, weekDates, type LocalDate } from '@shiftora/domain';

/**
 * Display helpers for the week board. Dates here are plain calendar dates ("2026-11-10") in
 * the location's time zone — never instants — so the board never shifts a shift by a day.
 * Day/week arithmetic comes from `packages/domain/time`; only formatting lives here.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parts(date: LocalDate): DateParts {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Today on this device. The board's week belongs to the location, but "today" is the manager's. */
export function todayLocalDate(now = new Date()): LocalDate {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "9–15 Nov 2026", "30 Nov – 6 Dec 2026", "28 Dec 2026 – 3 Jan 2027". */
export function weekLabel(weekStart: LocalDate): string {
  const dates = weekDates(weekStart);
  const from = parts(dates[0]!);
  const to = parts(dates[6]!);
  if (from.year !== to.year) {
    return `${from.day} ${MONTHS[from.month - 1]} ${from.year} – ${to.day} ${MONTHS[to.month - 1]} ${to.year}`;
  }
  if (from.month !== to.month) {
    return `${from.day} ${MONTHS[from.month - 1]} – ${to.day} ${MONTHS[to.month - 1]} ${to.year}`;
  }
  return `${from.day}–${to.day} ${MONTHS[from.month - 1]} ${to.year}`;
}

export function weekdayShort(date: LocalDate): string {
  return DAYS_SHORT[dayOfWeek(date) - 1]!;
}

export function weekdayLong(date: LocalDate): string {
  return DAYS_LONG[dayOfWeek(date) - 1]!;
}

export function dayOfMonth(date: LocalDate): string {
  return String(parts(date).day);
}

export function monthShort(date: LocalDate): string {
  return MONTHS[parts(date).month - 1]!;
}

/** "Tue 10 Nov", for aria labels and toasts. */
export function readableDate(date: LocalDate): string {
  const { day, month } = parts(date);
  return `${weekdayShort(date)} ${day} ${MONTHS[month - 1]}`;
}

/** A calendar date as the local-midnight Date that date pickers expect (never shifted by a zone). */
export function toCalendarDate(date: LocalDate): Date {
  const { year, month, day } = parts(date);
  return new Date(year, month - 1, day);
}

/** Back from a date picker: uses the picked day as shown, not its UTC instant. */
export function fromCalendarDate(value: Date): LocalDate {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

export function isWeekend(date: LocalDate): boolean {
  return dayOfWeek(date) > 5;
}

/** "7h 30m", "8h", "45m": compact, for shift chips. */
export function compactDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
