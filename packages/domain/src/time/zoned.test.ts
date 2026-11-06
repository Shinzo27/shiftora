import { describe, expect, it } from 'vitest';

import {
  addDays,
  dayOfWeek,
  isLocalDate,
  isWeekStart,
  localDayBounds,
  nominalMinutes,
  shiftTimes,
  startOfWeek,
  toInstant,
  toLocal,
  weekBounds,
  weekDates,
} from './zoned.js';

const LONDON = 'Europe/London';
const NEW_YORK = 'America/New_York';
const KOLKATA = 'Asia/Kolkata';
const HOUR = 60 * 60 * 1000;

const iso = (date: Date) => date.toISOString();
const hoursBetween = (bounds: { start: Date; end: Date }) =>
  (bounds.end.getTime() - bounds.start.getTime()) / HOUR;

// 2026 transitions:
//   London:   BST starts Sun 29 Mar (01:00 GMT → 02:00 BST), ends Sun 25 Oct (02:00 BST → 01:00 GMT)
//   New York: EDT starts Sun 8 Mar (02:00 → 03:00), ends Sun 1 Nov (02:00 → 01:00)
//   Kolkata:  no daylight saving, always UTC+05:30

describe('local dates', () => {
  it('validates YYYY-MM-DD dates, including leap days', () => {
    expect(isLocalDate('2026-03-29')).toBe(true);
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-3-9')).toBe(false);
    expect(isLocalDate('29/03/2026')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('finds the Monday a week starts on', () => {
    expect(dayOfWeek('2026-11-09')).toBe(1); // Monday
    expect(startOfWeek('2026-11-09')).toBe('2026-11-09');
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week before
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28'); // across the year
    expect(isWeekStart('2026-11-09')).toBe(true);
    expect(isWeekStart('2026-11-10')).toBe(false);
  });

  it('lists the seven dates of a week', () => {
    expect(weekDates('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
});

describe('toInstant: local wall-clock time + zone → UTC', () => {
  it('Asia/Kolkata is always UTC+05:30', () => {
    expect(iso(toInstant('2026-11-10', '09:00', KOLKATA))).toBe('2026-11-10T03:30:00.000Z');
    expect(iso(toInstant('2026-07-01', '09:00', KOLKATA))).toBe('2026-07-01T03:30:00.000Z');
  });

  it('follows the offset change in London', () => {
    expect(iso(toInstant('2026-01-15', '09:00', LONDON))).toBe('2026-01-15T09:00:00.000Z'); // GMT
    expect(iso(toInstant('2026-07-15', '09:00', LONDON))).toBe('2026-07-15T08:00:00.000Z'); // BST
  });

  it('spring-forward gap: a time that does not exist moves forward by the gap', () => {
    // 01:30 never happens in London on 29 Mar; it becomes 02:30 BST (= 01:30 UTC).
    expect(iso(toInstant('2026-03-29', '01:30', LONDON))).toBe('2026-03-29T01:30:00.000Z');
    // 02:30 never happens in New York on 8 Mar; it becomes 03:30 EDT (= 07:30 UTC).
    expect(iso(toInstant('2026-03-08', '02:30', NEW_YORK))).toBe('2026-03-08T07:30:00.000Z');
  });

  it('fall-back overlap: a time that happens twice means the first one', () => {
    // 01:30 happens twice in London on 25 Oct: first in BST (00:30 UTC), then GMT (01:30 UTC).
    expect(iso(toInstant('2026-10-25', '01:30', LONDON))).toBe('2026-10-25T00:30:00.000Z');
    // 01:30 happens twice in New York on 1 Nov: first in EDT (05:30 UTC).
    expect(iso(toInstant('2026-11-01', '01:30', NEW_YORK))).toBe('2026-11-01T05:30:00.000Z');
  });

  it('round-trips through toLocal', () => {
    for (const zone of [LONDON, NEW_YORK, KOLKATA]) {
      const instant = toInstant('2026-06-01', '23:45', zone);
      expect(toLocal(instant, zone)).toEqual({ date: '2026-06-01', time: '23:45' });
    }
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => toInstant('2026-02-30', '09:00', KOLKATA)).toThrow(RangeError);
    expect(() => toInstant('2026-02-01', '25:00', KOLKATA)).toThrow(RangeError);
    expect(() => toInstant('2026-02-01', '09:00', 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('days and weeks have real lengths', () => {
  it('a normal day is 24 h, the spring-forward day 23 h, the fall-back day 25 h', () => {
    expect(hoursBetween(localDayBounds('2026-03-28', LONDON))).toBe(24);
    expect(hoursBetween(localDayBounds('2026-03-29', LONDON))).toBe(23);
    expect(hoursBetween(localDayBounds('2026-10-25', LONDON))).toBe(25);
    expect(hoursBetween(localDayBounds('2026-03-08', NEW_YORK))).toBe(23);
    expect(hoursBetween(localDayBounds('2026-11-01', NEW_YORK))).toBe(25);
  });

  it('a week runs from local Monday midnight to the next Monday midnight', () => {
    const week = weekBounds('2026-11-09', KOLKATA);
    expect(iso(week.start)).toBe('2026-11-08T18:30:00.000Z');
    expect(iso(week.end)).toBe('2026-11-15T18:30:00.000Z');
    expect(hoursBetween(week)).toBe(168);
  });

  it('weeks containing a DST change are 167 or 169 hours', () => {
    expect(hoursBetween(weekBounds('2026-03-23', LONDON))).toBe(167); // contains 29 Mar
    expect(hoursBetween(weekBounds('2026-10-19', LONDON))).toBe(169); // contains 25 Oct
    expect(hoursBetween(weekBounds('2026-03-02', NEW_YORK))).toBe(167); // contains 8 Mar
    expect(hoursBetween(weekBounds('2026-10-26', NEW_YORK))).toBe(169); // contains 1 Nov
  });

  it('only accepts a Monday as a week start', () => {
    expect(() => weekBounds('2026-11-10', KOLKATA)).toThrow(RangeError);
  });
});

describe('shiftTimes: a shift on a local date', () => {
  it('a day shift', () => {
    const shift = shiftTimes('2026-11-10', '09:00', '17:00', KOLKATA);
    expect(iso(shift.startsAt)).toBe('2026-11-10T03:30:00.000Z');
    expect(iso(shift.endsAt)).toBe('2026-11-10T11:30:00.000Z');
    expect(shift.minutes).toBe(480);
  });

  it('an overnight shift ends the next day', () => {
    const shift = shiftTimes('2026-11-10', '22:00', '06:00', KOLKATA);
    expect(iso(shift.startsAt)).toBe('2026-11-10T16:30:00.000Z');
    expect(iso(shift.endsAt)).toBe('2026-11-11T00:30:00.000Z');
    expect(shift.minutes).toBe(480);
  });

  it('a night shift over the spring-forward change is an hour shorter', () => {
    expect(shiftTimes('2026-03-28', '22:00', '06:00', LONDON).minutes).toBe(7 * 60);
    expect(shiftTimes('2026-03-07', '22:00', '06:00', NEW_YORK).minutes).toBe(7 * 60);
  });

  it('a night shift over the fall-back change is an hour longer', () => {
    expect(shiftTimes('2026-10-24', '22:00', '06:00', LONDON).minutes).toBe(9 * 60);
    expect(shiftTimes('2026-10-31', '22:00', '06:00', NEW_YORK).minutes).toBe(9 * 60);
  });

  it('a shift may not start and end at the same time', () => {
    expect(() => shiftTimes('2026-11-10', '09:00', '09:00', KOLKATA)).toThrow(RangeError);
  });
});

describe('nominalMinutes: wall-clock length of a template', () => {
  it('counts overnight shifts across midnight', () => {
    expect(nominalMinutes('09:00', '17:30')).toBe(510);
    expect(nominalMinutes('22:00', '06:00')).toBe(480);
    expect(nominalMinutes('00:00', '23:59')).toBe(1439);
  });

  it('rejects equal or malformed times', () => {
    expect(() => nominalMinutes('09:00', '09:00')).toThrow(RangeError);
    expect(() => nominalMinutes('9am', '17:00')).toThrow(RangeError);
  });
});
