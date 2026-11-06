import { describe, expect, it } from 'vitest';

import { shiftTimes, weekBounds } from '../time/zoned.js';
import {
  availabilityWarnings,
  formatMinutes,
  maxWeeklyHoursWarnings,
  minRestWarnings,
  overlapWarnings,
  paidMinutes,
  spansOverlap,
  timeOffWarnings,
  uncoveredParts,
  validateShift,
  type ShiftHours,
} from './validation.js';

const at = (iso: string) => new Date(iso);
const hours = (startsAt: string, endsAt: string, breakMinutes = 0, id?: string): ShiftHours => ({
  startsAt: at(startsAt),
  endsAt: at(endsAt),
  breakMinutes,
  ...(id ? { id } : {}),
});

describe('spansOverlap', () => {
  it('treats the end as exclusive, so back-to-back shifts do not overlap', () => {
    const morning = hours('2026-11-09T02:30:00Z', '2026-11-09T09:30:00Z');
    const evening = hours('2026-11-09T09:30:00Z', '2026-11-09T15:30:00Z');
    expect(spansOverlap(morning, evening)).toBe(false);
    expect(spansOverlap(evening, morning)).toBe(false);
  });

  it('detects partial and full containment in both directions', () => {
    const day = hours('2026-11-09T00:00:00Z', '2026-11-09T10:00:00Z');
    const inside = hours('2026-11-09T02:00:00Z', '2026-11-09T04:00:00Z');
    expect(spansOverlap(day, inside)).toBe(true);
    expect(spansOverlap(inside, day)).toBe(true);
  });
});

describe('paidMinutes', () => {
  it('subtracts the unpaid break from the elapsed time', () => {
    expect(paidMinutes(hours('2026-11-09T02:30:00Z', '2026-11-09T10:30:00Z', 30))).toBe(450);
  });

  it('never goes negative when the break is longer than the shift', () => {
    expect(paidMinutes(hours('2026-11-09T02:30:00Z', '2026-11-09T03:00:00Z', 60))).toBe(0);
  });

  it('uses real elapsed time, so a DST night is 7 h or 9 h', () => {
    const springForward = shiftTimes('2026-03-28', '22:00', '06:00', 'Europe/London');
    const fallBack = shiftTimes('2026-10-24', '22:00', '06:00', 'Europe/London');
    const kolkata = shiftTimes('2026-11-09', '22:00', '06:00', 'Asia/Kolkata');
    expect(paidMinutes({ ...springForward, breakMinutes: 0 })).toBe(420);
    expect(paidMinutes({ ...fallBack, breakMinutes: 0 })).toBe(540);
    expect(paidMinutes({ ...kolkata, breakMinutes: 0 })).toBe(480);
  });
});

describe('overlapWarnings', () => {
  const candidate = hours('2026-11-09T02:30:00Z', '2026-11-09T10:30:00Z');

  it('names the conflicting shift in the location’s local time', () => {
    const other = hours('2026-11-09T08:30:00Z', '2026-11-09T14:30:00Z', 0, 'shift-1');
    const warnings = overlapWarnings(candidate, [other], 'Asia/Kolkata');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'overlap', shiftId: 'shift-1' });
    // 08:30Z is 14:00 in Kolkata; the next shift starts at 14:00 and ends at 20:00.
    expect(warnings[0]?.message).toBe('Already working Mon 14:00–20:00');
  });

  it('ignores shifts that only touch', () => {
    const after = hours('2026-11-09T10:30:00Z', '2026-11-09T14:00:00Z');
    expect(overlapWarnings(candidate, [after], 'Asia/Kolkata')).toEqual([]);
  });
});

describe('timeOffWarnings', () => {
  const candidate = hours('2026-11-09T02:30:00Z', '2026-11-09T10:30:00Z');

  it('reports booked time off that intersects the shift', () => {
    const periods = [
      { id: 'off-1', startsAt: at('2026-11-09T00:00:00Z'), endsAt: at('2026-11-10T00:00:00Z') },
    ];
    const warnings = timeOffWarnings(candidate, periods, 'Asia/Kolkata');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('time_off');
    expect(warnings[0]?.message).toContain('Mon 05:30');
  });

  it('ignores time off that ends when the shift starts', () => {
    const periods = [
      { id: 'off-1', startsAt: at('2026-11-08T00:00:00Z'), endsAt: at('2026-11-09T02:30:00Z') },
    ];
    expect(timeOffWarnings(candidate, periods, 'Asia/Kolkata')).toEqual([]);
  });
});

describe('availabilityWarnings', () => {
  const nineToFive = [{ weekday: 1, start: '09:00', end: '17:00' }];

  it('accepts a shift inside a slot, including its edges', () => {
    expect(
      availabilityWarnings({ weekday: 1, startTime: '09:00', endTime: '17:00' }, nineToFive),
    ).toEqual([]);
  });

  it('reports the uncovered part of a shift that starts too late', () => {
    const warnings = availabilityWarnings(
      { weekday: 1, startTime: '18:00', endTime: '22:00' },
      nineToFive,
    );
    expect(warnings).toEqual([{ code: 'unavailable', message: 'Not available Mon 18:00–22:00' }]);
  });

  it('reports both ends of a shift that straddles the slot', () => {
    const warnings = availabilityWarnings(
      { weekday: 1, startTime: '08:00', endTime: '18:00' },
      nineToFive,
    );
    expect(warnings.map((warning) => warning.message)).toEqual([
      'Not available Mon 08:00–09:00',
      'Not available Mon 17:00–18:00',
    ]);
  });

  it('treats no recorded availability as no restriction', () => {
    expect(availabilityWarnings({ weekday: 1, startTime: '03:00', endTime: '04:00' }, [])).toEqual(
      [],
    );
  });

  it('lets an overnight slot cover the next morning', () => {
    const nights = [{ weekday: 5, start: '22:00', end: '06:00' }];
    // Friday 22:00–06:00 covers Saturday 02:00–06:00.
    expect(
      availabilityWarnings({ weekday: 6, startTime: '02:00', endTime: '06:00' }, nights),
    ).toEqual([]);
    expect(
      availabilityWarnings({ weekday: 6, startTime: '05:00', endTime: '08:00' }, nights),
    ).toEqual([{ code: 'unavailable', message: 'Not available Sat 06:00–08:00' }]);
  });

  it('lets a Sunday night slot cover Monday morning', () => {
    const sundayNight = [{ weekday: 7, start: '22:00', end: '06:00' }];
    expect(
      availabilityWarnings({ weekday: 1, startTime: '00:00', endTime: '06:00' }, sundayNight),
    ).toEqual([]);
  });

  it('an overnight shift with no slot at night is uncovered across midnight', () => {
    const warnings = availabilityWarnings({ weekday: 1, startTime: '22:00', endTime: '06:00' }, [
      { weekday: 1, start: '09:00', end: '17:00' },
      { weekday: 2, start: '09:00', end: '17:00' },
    ]);
    expect(warnings).toEqual([
      { code: 'unavailable', message: 'Not available Mon 22:00–Tue 06:00' },
    ]);
  });

  it('covers a shift split across two adjacent slots', () => {
    const warnings = availabilityWarnings({ weekday: 1, startTime: '11:00', endTime: '14:00' }, [
      { weekday: 1, start: '09:00', end: '12:00' },
      { weekday: 1, start: '12:00', end: '17:00' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('reports the gap between two slots', () => {
    const gaps = uncoveredParts(
      [9 * 60, 15 * 60],
      [
        { weekday: 1, start: '09:00', end: '11:00' },
        { weekday: 1, start: '13:00', end: '17:00' },
      ],
    );
    expect(gaps).toEqual([[11 * 60, 13 * 60]]);
  });
});

describe('maxWeeklyHoursWarnings', () => {
  const week = weekBounds('2026-11-09', 'Asia/Kolkata');

  it('counts paid minutes of the week’s shifts plus the candidate', () => {
    const monday = hours('2026-11-09T02:30:00Z', '2026-11-09T10:30:00Z', 30);
    const tuesday = hours('2026-11-10T02:30:00Z', '2026-11-10T10:30:00Z', 30);
    const warnings = maxWeeklyHoursWarnings(tuesday, [monday], week, 900);
    // 450 + 450 = 900: exactly at the cap.
    expect(warnings).toEqual([]);
    expect(maxWeeklyHoursWarnings(tuesday, [monday], week, 899)[0]).toMatchObject({
      code: 'max_weekly_hours',
      message: 'This week would be 15 h (limit 14 h 59 m)',
    });
  });

  it('does nothing without a cap', () => {
    const shift = hours('2026-11-09T02:30:00Z', '2026-11-14T10:30:00Z');
    expect(maxWeeklyHoursWarnings(shift, [], week, null)).toEqual([]);
  });

  it('ignores shifts that start outside the schedule’s week', () => {
    // Sunday 08:00–16:00 IST, the week before: 8 h that must not count towards this week.
    const previousSunday = hours('2026-11-08T02:30:00Z', '2026-11-08T10:30:00Z');
    const monday = hours('2026-11-09T02:30:00Z', '2026-11-09T10:30:00Z');
    // 8 h alone fits a 10 h cap; 16 h together would not, so a warning at 500 would
    // mean the earlier week was counted. It is not.
    expect(maxWeeklyHoursWarnings(monday, [previousSunday], week, 600)).toEqual([]);
    expect(maxWeeklyHoursWarnings(monday, [previousSunday], week, 500)).toEqual([]);
    // The candidate itself is counted.
    expect(maxWeeklyHoursWarnings(monday, [previousSunday], week, 400)).toHaveLength(1);

    // A shift that starts before the week but ends inside it belongs to the earlier week.
    const straddling = hours('2026-11-08T18:00:00Z', '2026-11-09T03:00:00Z');
    expect(maxWeeklyHoursWarnings(monday, [straddling], week, 500)).toEqual([]);
  });
});

describe('minRestWarnings', () => {
  const evening = hours('2026-11-09T10:30:00Z', '2026-11-09T17:30:00Z', 0, 'evening');

  it('warns when the gap before the next shift is shorter than the rule', () => {
    const morning = hours('2026-11-10T02:30:00Z', '2026-11-10T10:30:00Z');
    const warnings = minRestWarnings(morning, [evening], 660, 'Asia/Kolkata');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'min_rest', shiftId: 'evening' });
    expect(warnings[0]?.message).toBe(
      'Only 9 h rest around the shift Mon 16:00–23:00 (needs 11 h)',
    );
  });

  it('accepts a gap that equals the rule', () => {
    const nextMorning = hours('2026-11-10T04:30:00Z', '2026-11-10T12:30:00Z');
    expect(minRestWarnings(nextMorning, [evening], 660, 'Asia/Kolkata')).toEqual([]);
  });

  it('checks the rest after the candidate too', () => {
    const earlier = hours('2026-11-09T02:30:00Z', '2026-11-09T09:30:00Z', 0, 'earlier');
    const warnings = minRestWarnings(evening, [earlier], 660, 'Asia/Kolkata');
    expect(warnings[0]?.shiftId).toBe('earlier');
  });

  it('leaves overlaps to the overlap check and does nothing without a rule', () => {
    expect(minRestWarnings(evening, [evening], 660, 'Asia/Kolkata')).toEqual([]);
    expect(minRestWarnings(evening, [evening], null, 'Asia/Kolkata')).toEqual([]);
  });
});

describe('formatMinutes', () => {
  it('prints hours and minutes, never days', () => {
    expect(formatMinutes(0)).toBe('0 m');
    expect(formatMinutes(45)).toBe('45 m');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(450)).toBe('7 h 30 m');
    expect(formatMinutes(2880)).toBe('48 h');
  });
});

describe('validateShift', () => {
  const week = weekBounds('2026-11-09', 'Asia/Kolkata');
  const candidate = {
    ...hours('2026-11-10T12:30:00Z', '2026-11-10T20:30:00Z'),
    weekday: 2,
    startTime: '18:00',
    endTime: '02:00',
  };

  it('returns every problem in a stable order', () => {
    const warnings = validateShift({
      candidate,
      timezone: 'Asia/Kolkata',
      week,
      availability: [{ weekday: 2, start: '09:00', end: '17:00' }],
      timeOff: [
        { id: 'off', startsAt: at('2026-11-10T00:00:00Z'), endsAt: at('2026-11-11T00:00:00Z') },
      ],
      otherShifts: [hours('2026-11-10T10:00:00Z', '2026-11-10T14:00:00Z', 0, 'other')],
      maxWeeklyMinutes: 480,
      minRestMinutes: 660,
    });
    expect(warnings.map((warning) => warning.code)).toEqual([
      'overlap',
      'time_off',
      'unavailable',
      'max_weekly_hours',
    ]);
  });

  it('is happy with a clean shift', () => {
    expect(
      validateShift({
        candidate: { ...candidate, weekday: 2, startTime: '18:00', endTime: '22:00' },
        timezone: 'Asia/Kolkata',
        week,
        availability: [{ weekday: 2, start: '09:00', end: '22:00' }],
        timeOff: [],
        otherShifts: [],
        maxWeeklyMinutes: 2880,
        minRestMinutes: 660,
      }),
    ).toEqual([]);
  });
});
