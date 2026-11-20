import { describe, expect, it } from 'vitest';

import {
  createEmployeeRequest,
  createTimeOffRequest,
  listEmployeesQuery,
  setAvailabilityRequest,
} from './employees.js';

describe('createEmployeeRequest', () => {
  it('needs only a name; rate defaults to 0', () => {
    expect(createEmployeeRequest.parse({ name: ' Nina ' })).toEqual({
      name: 'Nina',
      hourlyRateMinor: 0,
    });
  });

  it.each([
    ['local phone number', { phone: '9812345678' }, 'phone'],
    ['fractional rate', { hourlyRateMinor: 150.5 }, 'hourlyRateMinor'],
    ['more than a week of minutes', { maxWeeklyMinutes: 10_081 }, 'maxWeeklyMinutes'],
  ])('rejects %s', (_label, override, field) => {
    const result = createEmployeeRequest.safeParse({ name: 'Nina', ...override });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(field);
  });
});

describe('listEmployeesQuery', () => {
  it('coerces limit from the query string and applies defaults', () => {
    expect(listEmployeesQuery.parse({ limit: '20' })).toEqual({ limit: 20, status: 'active' });
  });
});

describe('setAvailabilityRequest', () => {
  it('points at the overlapping slot', () => {
    const result = setAvailabilityRequest.safeParse({
      slots: [
        { weekday: 1, start: '09:00', end: '13:00' },
        { weekday: 1, start: '12:00', end: '15:00' },
      ],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['slots', 1], message: 'Overlaps time 1' }),
    ]);
  });
});

describe('createTimeOffRequest', () => {
  it('requires an explicit offset and an end after the start', () => {
    expect(
      createTimeOffRequest.safeParse({
        startsAt: '2026-11-10T09:00:00+05:30',
        endsAt: '2026-11-10T18:00:00+05:30',
      }).success,
    ).toBe(true);
    expect(
      createTimeOffRequest.safeParse({
        startsAt: '2026-11-10T09:00:00',
        endsAt: '2026-11-10T18:00:00',
      }).success,
    ).toBe(false);
    const backwards = createTimeOffRequest.safeParse({
      startsAt: '2026-11-10T18:00:00Z',
      endsAt: '2026-11-10T09:00:00Z',
    });
    expect(backwards.error?.issues[0]?.path).toEqual(['endsAt']);
  });
});
