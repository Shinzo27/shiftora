import { describe, expect, it } from 'vitest';

import { assessAssignment, canTakeOpenShift, needsAcknowledgement } from './eligibility.js';
import type { ShiftWarning } from './validation.js';

const andheri = 'loc-andheri';
const nurse = 'role-nurse';

const base = {
  employee: { status: 'active' as const, locationIds: [andheri], jobRoleIds: [nurse] },
  shift: { locationId: andheri, jobRoleId: nurse },
  warnings: [] as ShiftWarning[],
};

describe('assessAssignment', () => {
  it('a nurse at the branch with a free day can take a nurse shift', () => {
    const result = assessAssignment(base);
    expect(result).toEqual({ blocking: [], advisories: [] });
    expect(canTakeOpenShift(result)).toBe(true);
    expect(needsAcknowledgement(result)).toBe(false);
  });

  it('blocks someone archived, elsewhere, or without the role — whatever else is true', () => {
    const result = assessAssignment({
      ...base,
      employee: { status: 'archived', locationIds: ['loc-bandra'], jobRoleIds: [] },
    });
    expect(result.blocking.map((b) => b.reason)).toEqual([
      'archived',
      'not_at_location',
      'missing_role',
    ]);
    expect(canTakeOpenShift(result)).toBe(false);
  });

  it('a shift with no job role is open to anyone at the location', () => {
    const result = assessAssignment({
      ...base,
      employee: { ...base.employee, jobRoleIds: [] },
      shift: { locationId: andheri, jobRoleId: null },
    });
    expect(result.blocking).toEqual([]);
  });

  it('overlap is blocking; the other warnings are advisories', () => {
    const result = assessAssignment({
      ...base,
      warnings: [
        { code: 'overlap', message: 'Overlaps Tue 09:00–17:00' },
        { code: 'min_rest', message: 'Only 6h rest' },
      ],
    });
    expect(result.blocking).toEqual([{ reason: 'overlap', message: 'Overlaps Tue 09:00–17:00' }]);
    expect(result.advisories.map((w) => w.code)).toEqual(['min_rest']);
  });
});

describe('who is offered an open shift', () => {
  it('availability is a preference: still offered', () => {
    const result = assessAssignment({
      ...base,
      warnings: [{ code: 'unavailable', message: 'Not available Tue 18:00–22:00' }],
    });
    expect(canTakeOpenShift(result)).toBe(true);
  });

  it.each(['time_off', 'max_weekly_hours', 'min_rest'] as const)(
    '%s keeps the shift from being offered',
    (code) => {
      const result = assessAssignment({ ...base, warnings: [{ code, message: code }] });
      expect(canTakeOpenShift(result)).toBe(false);
    },
  );
});

describe('approval', () => {
  it('any advisory, availability included, needs the manager to say yes anyway', () => {
    const result = assessAssignment({
      ...base,
      warnings: [{ code: 'unavailable', message: 'Not available' }],
    });
    expect(needsAcknowledgement(result)).toBe(true);
  });
});
