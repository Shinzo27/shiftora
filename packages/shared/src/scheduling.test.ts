import { describe, expect, it } from 'vitest';

import {
  createScheduleRequest,
  createShiftTemplateRequest,
  shiftTemplateIssue,
  updateShiftTemplateRequest,
} from './scheduling.js';

const LOCATION = '01a1b01a-af16-752e-9c0d-65a63981982c';
const template = { locationId: LOCATION, name: 'Morning', startTime: '07:00', endTime: '15:00' };

const failingPaths = (result: { error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.'));

describe('createShiftTemplateRequest', () => {
  it('defaults the break to 0 minutes', () => {
    expect(createShiftTemplateRequest.parse(template).breakMinutes).toBe(0);
  });

  it('accepts an overnight template (end before start)', () => {
    const night = { ...template, startTime: '22:00', endTime: '06:00', breakMinutes: 30 };
    expect(createShiftTemplateRequest.safeParse(night).success).toBe(true);
  });

  it.each([
    ['equal start and end', { endTime: '07:00' }, 'endTime'],
    ['a break as long as the shift', { breakMinutes: 480 }, 'breakMinutes'],
    ['a break over 4 hours', { breakMinutes: 300 }, 'breakMinutes'],
    ['a 12-hour time', { startTime: '7am' }, 'startTime'],
    ['a blank name', { name: '  ' }, 'name'],
  ])('rejects %s', (_label, override, field) => {
    expect(
      failingPaths(createShiftTemplateRequest.safeParse({ ...template, ...override })),
    ).toContain(field);
  });
});

describe('shiftTemplateIssue (used for updates after merging)', () => {
  it('checks the break against an overnight length', () => {
    expect(shiftTemplateIssue('22:00', '06:00', 479)).toBeNull();
    expect(shiftTemplateIssue('22:00', '06:00', 480)?.path).toBe('breakMinutes');
  });

  it('an update must change something', () => {
    expect(updateShiftTemplateRequest.safeParse({}).success).toBe(false);
  });
});

describe('createScheduleRequest', () => {
  it('accepts a Monday', () => {
    expect(
      createScheduleRequest.safeParse({ locationId: LOCATION, weekStart: '2026-11-09' }).success,
    ).toBe(true);
  });

  it.each([
    ['a Tuesday', '2026-11-10'],
    ['an impossible date', '2026-02-30'],
    ['another format', '09/11/2026'],
  ])('rejects %s as a week start', (_label, weekStart) => {
    expect(
      failingPaths(createScheduleRequest.safeParse({ locationId: LOCATION, weekStart })),
    ).toContain('weekStart');
  });
});
