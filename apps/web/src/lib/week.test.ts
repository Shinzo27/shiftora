import { describe, expect, it } from 'vitest';

import {
  compactDuration,
  dayHeading,
  dayOfMonth,
  fromCalendarDate,
  isWeekend,
  monthShort,
  readableDate,
  toCalendarDate,
  todayLocalDate,
  weekLabel,
  weekdayShort,
} from './week.js';

describe('weekLabel', () => {
  it('names a week inside one month once', () => {
    expect(weekLabel('2026-11-09')).toBe('9–15 Nov 2026');
  });

  it('names both months when the week straddles them', () => {
    expect(weekLabel('2026-11-30')).toBe('30 Nov – 6 Dec 2026');
  });

  it('names both years when the week straddles them', () => {
    expect(weekLabel('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
  });
});

describe('calendar round trip', () => {
  it('turns a date into the local Date a picker shows, and back, unchanged', () => {
    // A local-midnight Date is what react-day-picker works with; using UTC would shift the
    // day west of Greenwich.
    expect(fromCalendarDate(toCalendarDate('2026-11-09'))).toBe('2026-11-09');
    expect(toCalendarDate('2026-11-09').getDate()).toBe(9);
    expect(toCalendarDate('2026-11-09').getMonth()).toBe(10);
  });

  it('survives a month boundary in both directions', () => {
    expect(fromCalendarDate(toCalendarDate('2026-12-31'))).toBe('2026-12-31');
    expect(fromCalendarDate(toCalendarDate('2027-01-01'))).toBe('2027-01-01');
  });
});

describe('day labels', () => {
  it('names weekdays and months', () => {
    expect(weekdayShort('2026-11-09')).toBe('Mon');
    expect(weekdayShort('2026-11-15')).toBe('Sun');
    expect(monthShort('2026-11-09')).toBe('Nov');
    expect(dayOfMonth('2026-11-09')).toBe('9');
    expect(readableDate('2026-11-10')).toBe('Tue 10 Nov');
  });

  it('knows the weekend', () => {
    expect(isWeekend('2026-11-14')).toBe(true);
    expect(isWeekend('2026-11-15')).toBe(true);
    expect(isWeekend('2026-11-13')).toBe(false);
  });
});

describe('todayLocalDate', () => {
  it('uses the device calendar date, zero-padded', () => {
    expect(todayLocalDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(todayLocalDate(new Date(2026, 10, 12, 0, 5))).toBe('2026-11-12');
  });
});

describe('compactDuration', () => {
  it('prints hours and minutes for chips', () => {
    expect(compactDuration(0)).toBe('0m');
    expect(compactDuration(45)).toBe('45m');
    expect(compactDuration(480)).toBe('8h');
    expect(compactDuration(450)).toBe('7h 30m');
  });
});

describe('dayHeading', () => {
  const today = '2026-11-12';

  it('names the days people actually think in', () => {
    expect(dayHeading(today, today)).toBe('Today');
    expect(dayHeading('2026-11-13', today)).toBe('Tomorrow');
    expect(dayHeading('2026-11-11', today)).toBe('Yesterday');
  });

  it('falls back to a date, including across a month end', () => {
    expect(dayHeading('2026-11-14', today)).toBe('Sat 14 Nov');
    expect(dayHeading('2026-12-01', today)).toBe('Tue 1 Dec');
  });
});
