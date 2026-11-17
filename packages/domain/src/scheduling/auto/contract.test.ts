import { describe, expect, it } from 'vitest';

import { dateOfWeekday, expandWeek, type CoverageRequirement } from './contract.js';

const WEEK = '2027-03-01'; // a Monday

const requirement = (over: Partial<CoverageRequirement> = {}): CoverageRequirement => ({
  id: 'req-1',
  locationId: 'loc-1',
  weekday: 1,
  jobRoleId: null,
  startLocal: '09:00',
  endLocal: '17:00',
  headcount: 1,
  ...over,
});

describe('dateOfWeekday', () => {
  it('puts Monday on the week start and Sunday six days later', () => {
    expect(dateOfWeekday(WEEK, 1)).toBe('2027-03-01');
    expect(dateOfWeekday(WEEK, 7)).toBe('2027-03-07');
  });
});

describe('expandWeek', () => {
  it('makes one slot per requirement', () => {
    const slots = expandWeek({ weekStart: WEEK, requirements: [requirement()] });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ id: 'req-1#0', date: '2027-03-01', startLocal: '09:00' });
  });

  it('turns headcount into repeats, each with its own id', () => {
    // Two nurses on Monday is two slots, because it may well be two different people.
    const slots = expandWeek({
      weekStart: WEEK,
      requirements: [requirement({ headcount: 2 })],
    });
    expect(slots.map((slot) => slot.id)).toEqual(['req-1#0', 'req-1#1']);
    expect(new Set(slots.map((slot) => slot.date))).toEqual(new Set(['2027-03-01']));
  });

  it('places each requirement on its own weekday', () => {
    const slots = expandWeek({
      weekStart: WEEK,
      requirements: [
        requirement({ id: 'mon', weekday: 1 }),
        requirement({ id: 'fri', weekday: 5, startLocal: '18:00', endLocal: '22:00' }),
      ],
    });
    expect(slots.map((slot) => [slot.id, slot.date])).toEqual([
      ['mon#0', '2027-03-01'],
      ['fri#0', '2027-03-05'],
    ]);
  });

  it('produces stable ids, so a solved week can be diffed against a re-run', () => {
    const once = expandWeek({ weekStart: WEEK, requirements: [requirement({ headcount: 3 })] });
    const twice = expandWeek({ weekStart: WEEK, requirements: [requirement({ headcount: 3 })] });
    expect(once.map((slot) => slot.id)).toEqual(twice.map((slot) => slot.id));
  });

  it('carries the role through, including "anyone"', () => {
    const slots = expandWeek({
      weekStart: WEEK,
      requirements: [
        requirement({ jobRoleId: 'nurse' }),
        requirement({ id: 'r2', startLocal: '10:00' }),
      ],
    });
    expect(slots.map((slot) => slot.jobRoleId)).toEqual(['nurse', null]);
  });
});
