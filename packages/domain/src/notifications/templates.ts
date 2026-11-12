import { addDays, type LocalDate, type LocalTime } from '../time/zoned.js';
import { nominalMinutes } from '../time/zoned.js';

/** A message as it will be read on a phone: a subject for email, a body for everything. */
export interface RenderedMessage {
  subject: string;
  body: string;
}

export interface ShiftLine {
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
  roleName?: string | null;
}

export interface SchedulePublishedContext {
  employeeName: string;
  orgName: string;
  locationName: string;
  weekStart: LocalDate;
  shifts: ShiftLine[];
  /** What changed, from the publication diff: this is why the message is worth reading. */
  changes: { added: number; changed: number; removed: number };
  appUrl?: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Your week is published", as a person would say it.
 *
 * Plain text on purpose: it has to survive WhatsApp's utility templates (no markdown, and a
 * 1024-character body), an SMS fallback that truncates at 160, and an email that renders
 * better when it is not dressed up. The first line carries the news, because that is all a
 * notification preview shows.
 */
export function renderSchedulePublished(context: SchedulePublishedContext): RenderedMessage {
  const { employeeName, orgName, locationName, weekStart, shifts, changes, appUrl } = context;
  const weekday = firstName(employeeName);
  const subject = `Your shifts at ${locationName} · ${weekRange(weekStart)}`;

  if (shifts.length === 0) {
    return {
      subject,
      body: [
        `Hi ${weekday}, your week at ${orgName} — ${locationName} is published.`,
        '',
        `Nothing is rostered for you from ${weekRange(weekStart)}.`,
        ...(appUrl ? ['', `See the week: ${appUrl}`] : []),
      ].join('\n'),
    };
  }

  const lines = [...shifts]
    .sort((a, b) =>
      a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date),
    )
    .map((shift) => {
      const total = nominalMinutes(shift.startTime, shift.endTime);
      const hours = `${Math.floor(total / 60)}h${total % 60 ? ` ${total % 60}m` : ''}`;
      const role = shift.roleName ? ` · ${shift.roleName}` : '';
      return `${dayLabel(shift.date)} · ${shift.startTime}–${shift.endTime} (${hours})${role}`;
    });

  const totalMinutes = shifts.reduce(
    (sum, shift) => sum + nominalMinutes(shift.startTime, shift.endTime),
    0,
  );

  return {
    subject,
    body: [
      `Hi ${weekday}, your week at ${orgName} — ${locationName} is published.`,
      '',
      ...lines,
      '',
      `${shifts.length} shift${shifts.length === 1 ? '' : 's'} · ${hoursLabel(totalMinutes)} this week.`,
      ...(changeLine(changes) ? ['', changeLine(changes)] : []),
      ...(appUrl ? ['', `Open the app to swap or ask for leave: ${appUrl}`] : []),
    ].join('\n'),
  };
}

export interface ShiftReminderContext {
  employeeName: string;
  orgName: string;
  locationName: string;
  date: LocalDate;
  startTime: LocalTime;
  endTime: LocalTime;
  /** "in 2 hours", computed by the caller from the location's clock. */
  lead: string;
  appUrl?: string;
}

/** The nudge before a shift — short, because it is read on the way out of the door. */
export function renderShiftReminder(context: ShiftReminderContext): RenderedMessage {
  const { employeeName, orgName, locationName, date, startTime, endTime, lead, appUrl } = context;
  return {
    subject: `Shift ${lead} · ${dayLabel(date)} ${startTime}–${endTime}`,
    body: [
      `Hi ${firstName(employeeName)}, your shift at ${orgName} — ${locationName} starts ${lead}.`,
      '',
      `${dayLabel(date)} · ${startTime}–${endTime}`,
      ...(appUrl ? ['', `Clock in when you arrive: ${appUrl}`] : []),
    ].join('\n'),
  };
}

export interface MissedClockInContext {
  employeeName: string;
  orgName: string;
  locationName: string;
  date: LocalDate;
  startTime: LocalTime;
}

/**
 * Sent when a shift started and nobody clocked in. Addressed to the employee, not the manager:
 * "did you forget?" is the question that gets a shift started.
 */
export function renderMissedClockIn(context: MissedClockInContext): RenderedMessage {
  const { employeeName, orgName, locationName, date, startTime } = context;
  return {
    subject: `Did you clock in today? · ${dayLabel(date)} ${startTime}`,
    body: [
      `Hi ${firstName(employeeName)}, your shift at ${orgName} — ${locationName} started at ${startTime} on ${dayLabel(date)} and no clock-in has come through.`,
      '',
      'If you are there, clock in now; your manager can fix the time later if not.',
    ].join('\n'),
  };
}

/** "9–15 Nov" — the range a person reads, not two dates. */
export function weekRange(weekStart: LocalDate): string {
  const end = addDays(weekStart, 6);
  const startDate = parts(weekStart);
  const endDate = parts(end);
  return startDate.month === endDate.month
    ? `${startDate.day}–${endDate.day} ${endDate.monthName}`
    : `${startDate.day} ${startDate.monthName} – ${endDate.day} ${endDate.monthName}`;
}

/** "Mon 9 Nov". */
export function dayLabel(date: LocalDate): string {
  const { year, month, day } = parse(date);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const index = weekday === 0 ? 6 : weekday - 1;
  const { monthName } = parts(date);
  return `${DAYS[index]} ${day} ${monthName}`;
}

function hoursLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

function changeLine(changes: { added: number; changed: number; removed: number }): string {
  const parts: string[] = [];
  if (changes.added) parts.push(`${changes.added} new`);
  if (changes.changed) parts.push(`${changes.changed} changed`);
  if (changes.removed) parts.push(`${changes.removed} removed`);
  return parts.length ? `Changed since last week: ${parts.join(', ')}.` : '';
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function parse(date: LocalDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function parts(date: LocalDate): { day: number; monthName: string; month: number } {
  const { month, day } = parse(date);
  return { day, month, monthName: MONTHS[month - 1] ?? '' };
}
