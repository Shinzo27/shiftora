import { describe, expect, it } from 'vitest';

import { changesOf, describeAction, fieldLabel, formatValue, periodStart } from './audit';

describe('describeAction', () => {
  it('names the kind of thing and what happened to it', () => {
    expect(describeAction('shift_request.approved')).toBe('Shift request approved');
    expect(describeAction('membership.role_changed')).toBe('Member role changed');
    expect(describeAction('time_entry.updated')).toBe('Punch updated');
  });

  it('copes with a kind it does not know yet', () => {
    expect(describeAction('kiosk_code.rotated')).toBe('Kiosk code rotated');
  });
});

describe('fieldLabel', () => {
  it('reads camelCase and snake_case keys as words', () => {
    expect(fieldLabel('hourlyRateMinor')).toBe('hourly rate');
    expect(fieldLabel('job_role_id')).toBe('job role id');
  });
});

describe('formatValue', () => {
  it('keeps one line short and readable', () => {
    expect(formatValue(null)).toBe('—');
    expect(formatValue(true)).toBe('yes');
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue([])).toBe('none');
    expect(formatValue([{ a: 1 }, { b: 2 }])).toBe('2 items');
    expect(formatValue({ note: 'x'.repeat(100) })).toHaveLength(78);
  });
});

describe('changesOf', () => {
  it('lists only the fields that changed', () => {
    expect(
      changesOf(
        { name: 'Nurse', locationIds: ['a'], role: 'manager' },
        { name: 'Staff nurse', locationIds: ['a'], role: 'manager' },
      ),
    ).toEqual([{ field: 'name', from: 'Nurse', to: 'Staff nurse' }]);
  });

  it('shows money in rupees, not paise', () => {
    expect(changesOf({ hourlyRateMinor: 45_000 }, { hourlyRateMinor: 32_000 })).toEqual([
      { field: 'hourly rate', from: '₹450.00', to: '₹320.00' },
    ]);
  });

  it('a creation has only new values; a removal only old ones', () => {
    expect(changesOf(null, { role: 'employee' })).toEqual([{ field: 'role', to: 'employee' }]);
    expect(changesOf({ role: 'employee' }, null)).toEqual([{ field: 'role', from: 'employee' }]);
  });

  it('a field that appears or disappears counts as a change', () => {
    expect(changesOf({ note: 'late' }, { reason: 'traffic' })).toEqual([
      { field: 'note', from: 'late', to: '—' },
      { field: 'reason', from: '—', to: 'traffic' },
    ]);
  });
});

describe('periodStart', () => {
  const now = new Date('2026-11-18T03:00:00Z'); // 08:30 in Kolkata

  it('starts at local midnight, counting today', () => {
    expect(periodStart('7', now, 'Asia/Kolkata')).toBe('2026-11-11T18:30:00.000Z'); // 12 Nov 00:00 IST
    expect(periodStart('all', now, 'Asia/Kolkata')).toBeUndefined();
  });

  it('crosses a DST change on the wall clock, not in hours', () => {
    // London leaves summer time on 25 Oct 2026: 30 days back from 18 Nov is 20 Oct, still BST.
    expect(periodStart('30', now, 'Europe/London')).toBe('2026-10-19T23:00:00.000Z');
  });
});
