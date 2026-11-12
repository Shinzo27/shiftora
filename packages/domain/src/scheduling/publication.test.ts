import { describe, expect, it } from 'vitest';

import { diffPublication, type PublishedShift } from './publication.js';

function shift(overrides: Partial<PublishedShift> = {}): PublishedShift {
  return {
    shiftId: 'shift-1',
    employeeId: 'employee-1',
    date: '2026-11-09',
    startTime: '09:00',
    endTime: '17:00',
    breakMinutes: 30,
    jobRoleId: 'role-1',
    ...overrides,
  };
}

describe('diffPublication', () => {
  it('reports nothing when the week is unchanged', () => {
    const week = [shift(), shift({ shiftId: 'shift-2', employeeId: 'employee-2' })];
    expect(diffPublication(week, week)).toEqual({
      added: [],
      changed: [],
      removed: [],
      affectedEmployeeIds: [],
    });
  });

  it('reports a new shift and only the person on it', () => {
    const diff = diffPublication(
      [shift()],
      [shift(), shift({ shiftId: 'shift-2', employeeId: 'e2' })],
    );
    expect(diff.added.map((item) => item.shiftId)).toEqual(['shift-2']);
    expect(diff.affectedEmployeeIds).toEqual(['e2']);
  });

  it('reports a removed shift and the person who loses it', () => {
    const diff = diffPublication(
      [shift(), shift({ shiftId: 'shift-2', employeeId: 'e2' })],
      [shift()],
    );
    expect(diff.removed.map((item) => item.shiftId)).toEqual(['shift-2']);
    expect(diff.affectedEmployeeIds).toEqual(['e2']);
  });

  it('tells both people about a shift that changes hands', () => {
    const diff = diffPublication([shift()], [shift({ employeeId: 'employee-2' })]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.affectedEmployeeIds).toEqual(['employee-1', 'employee-2']);
  });

  it('counts a moved day, changed times, break or role as a change', () => {
    const previous = [
      shift(),
      shift({ shiftId: 'shift-2' }),
      shift({ shiftId: 'shift-3' }),
      shift({ shiftId: 'shift-4' }),
    ];
    const diff = diffPublication(previous, [
      shift({ date: '2026-11-10' }),
      shift({ shiftId: 'shift-2', startTime: '10:00', endTime: '18:00' }),
      shift({ shiftId: 'shift-3', breakMinutes: 0 }),
      shift({ shiftId: 'shift-4', jobRoleId: null }),
    ]);
    expect(diff.changed).toHaveLength(4);
    expect(diff.added).toEqual([]);
  });

  it('ignores an open shift for the affected list but still reports it', () => {
    const diff = diffPublication([], [shift({ employeeId: null })]);
    expect(diff.added).toHaveLength(1);
    expect(diff.affectedEmployeeIds).toEqual([]);
  });

  it('treats assignment of an open shift as a change for whoever takes it', () => {
    const diff = diffPublication([shift({ employeeId: null })], [shift({ employeeId: 'e9' })]);
    expect(diff.changed).toHaveLength(1);
    expect(diff.affectedEmployeeIds).toEqual(['e9']);
  });

  it('sorts the arrays chronologically so the same week always reads the same', () => {
    const diff = diffPublication(
      [],
      [
        shift({ shiftId: 'c', date: '2026-11-11' }),
        shift({ shiftId: 'a', date: '2026-11-09' }),
        shift({ shiftId: 'b', date: '2026-11-09', startTime: '08:00' }),
      ],
    );
    expect(diff.added.map((item) => item.shiftId)).toEqual(['b', 'a', 'c']);
  });
});
