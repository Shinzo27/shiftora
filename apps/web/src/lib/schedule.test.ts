import type { Shift, ShiftConflict } from '@shiftora/shared';
import { describe, expect, it } from 'vitest';

import { applyShiftMove, conflictMap } from './schedule.js';

function shift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    scheduleId: 'schedule-1',
    locationId: 'location-1',
    jobRoleId: null,
    employeeId: 'employee-1',
    startsAt: '2026-11-09T03:30:00.000Z',
    endsAt: '2026-11-09T11:30:00.000Z',
    date: '2026-11-09',
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: 0,
    paidMinutes: 480,
    status: 'assigned',
    version: 3,
    notes: null,
    createdAt: '2026-11-06T10:00:00.000Z',
    updatedAt: '2026-11-06T10:00:00.000Z',
    ...overrides,
  };
}

describe('applyShiftMove', () => {
  it('moves the shift to another day and leaves the others alone', () => {
    const other = shift({ id: 'shift-2', date: '2026-11-10' });
    const moved = applyShiftMove([shift(), other], {
      id: 'shift-1',
      date: '2026-11-12',
      employeeId: 'employee-1',
    });
    expect(moved[0]?.date).toBe('2026-11-12');
    expect(moved[1]).toBe(other);
    // Times are untouched: a drag changes the day, not the clock.
    expect(moved[0]?.startTime).toBe('09:00');
    expect(moved[0]?.version).toBe(3);
  });

  it('assigns an open shift and re-opens an assigned one', () => {
    const open = shift({ employeeId: null, status: 'open' });
    const assigned = applyShiftMove([open], {
      id: 'shift-1',
      date: '2026-11-09',
      employeeId: 'employee-2',
    });
    expect(assigned[0]).toMatchObject({ employeeId: 'employee-2', status: 'assigned' });

    const reopened = applyShiftMove(assigned, {
      id: 'shift-1',
      date: '2026-11-09',
      employeeId: null,
    });
    expect(reopened[0]).toMatchObject({ employeeId: null, status: 'open' });
  });

  it('does not mutate the list it was given (the rollback copy must stay intact)', () => {
    const original = [shift()];
    applyShiftMove(original, { id: 'shift-1', date: '2026-11-14', employeeId: null });
    expect(original[0]?.date).toBe('2026-11-09');
    expect(original[0]?.employeeId).toBe('employee-1');
  });
});

describe('conflictMap', () => {
  it('keys warnings by shift id', () => {
    const conflicts: ShiftConflict[] = [
      { shiftId: 'shift-1', warnings: [{ code: 'unavailable', message: 'Not available Mon' }] },
      { shiftId: 'shift-2', warnings: [{ code: 'min_rest', message: 'Only 9 h rest' }] },
    ];
    const map = conflictMap(conflicts);
    expect(map.get('shift-1')?.[0]?.code).toBe('unavailable');
    expect(map.get('shift-2')).toHaveLength(1);
    expect(map.get('shift-3')).toBeUndefined();
  });

  it('handles a week that has not loaded yet', () => {
    expect(conflictMap(undefined).size).toBe(0);
  });
});
