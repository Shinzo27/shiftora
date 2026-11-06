import { describe, expect, it } from 'vitest';

import { parseLocalTime, validateWeeklySlots, type WeeklySlot } from './weekly.js';

const slot = (weekday: WeeklySlot['weekday'], start: string, end: string): WeeklySlot => ({
  weekday,
  start,
  end,
});

describe('parseLocalTime', () => {
  it.each([
    ['00:00', 0],
    ['09:30', 570],
    ['23:59', 1439],
  ])('%s → %i minutes', (value, minutes) => {
    expect(parseLocalTime(value)).toBe(minutes);
  });

  it.each(['24:00', '9:30', '09:60', 'noon', ''])('rejects %j', (value) => {
    expect(parseLocalTime(value)).toBeNull();
  });
});

describe('validateWeeklySlots', () => {
  it('accepts a normal week, including back-to-back slots', () => {
    expect(
      validateWeeklySlots([
        slot(1, '09:00', '13:00'),
        slot(1, '13:00', '17:00'),
        slot(2, '09:00', '17:00'),
      ]),
    ).toEqual([]);
  });

  it('accepts an overnight slot that ends before the next day starts', () => {
    expect(validateWeeklySlots([slot(5, '22:00', '06:00'), slot(6, '06:00', '14:00')])).toEqual([]);
  });

  it('flags overlapping slots on the same day', () => {
    expect(validateWeeklySlots([slot(1, '09:00', '13:00'), slot(1, '12:00', '18:00')])).toEqual([
      { index: 1, message: 'Overlaps slot 1' },
    ]);
  });

  it('flags an overnight slot that runs into the next day’s slot', () => {
    expect(validateWeeklySlots([slot(5, '22:00', '06:00'), slot(6, '05:00', '09:00')])).toEqual([
      { index: 1, message: 'Overlaps slot 1' },
    ]);
  });

  it('wraps around the week: Sunday night overlaps Monday morning', () => {
    expect(validateWeeklySlots([slot(7, '22:00', '06:00'), slot(1, '05:00', '09:00')])).toEqual([
      { index: 1, message: 'Overlaps slot 1' },
    ]);
  });

  it('flags zero-length and malformed slots', () => {
    expect(validateWeeklySlots([slot(1, '09:00', '09:00'), slot(2, '9am', '5pm')])).toEqual([
      { index: 0, message: 'Use HH:MM times, and start and end must differ' },
      { index: 1, message: 'Use HH:MM times, and start and end must differ' },
    ]);
  });
});
