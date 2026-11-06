import { describe, expect, it } from 'vitest';

import { createShiftRequest, updateShiftRequest } from './shifts.js';

const base = {
  scheduleId: '0192f8f2-0f1a-7a3c-9d1e-3b6c5a4d2e10',
  date: '2026-11-10',
  startTime: '09:00',
  endTime: '17:00',
};

describe('createShiftRequest', () => {
  it('accepts a normal shift and defaults the break to 0', () => {
    const parsed = createShiftRequest.parse(base);
    expect(parsed.breakMinutes).toBe(0);
    expect(parsed.employeeId).toBeUndefined();
  });

  it('rejects a zero-length shift', () => {
    const result = createShiftRequest.safeParse({ ...base, endTime: '09:00' });
    expect(result.success).toBe(false);
  });

  it('rejects a break as long as the shift', () => {
    const result = createShiftRequest.safeParse({
      ...base,
      startTime: '09:00',
      endTime: '10:00',
      breakMinutes: 60,
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(['breakMinutes']);
  });

  it('allows an overnight shift whose break fits', () => {
    expect(
      createShiftRequest.safeParse({
        ...base,
        startTime: '22:00',
        endTime: '06:00',
        breakMinutes: 30,
      }).success,
    ).toBe(true);
  });

  it('requires a real date', () => {
    expect(createShiftRequest.safeParse({ ...base, date: '2026-02-30' }).success).toBe(false);
    expect(createShiftRequest.safeParse({ ...base, date: '10/11/2026' }).success).toBe(false);
  });
});

describe('updateShiftRequest', () => {
  it('accepts a single field', () => {
    expect(updateShiftRequest.safeParse({ breakMinutes: 15 }).success).toBe(true);
    expect(updateShiftRequest.safeParse({ employeeId: null }).success).toBe(true);
  });

  it('rejects an empty body and a version on its own', () => {
    expect(updateShiftRequest.safeParse({}).success).toBe(false);
    expect(updateShiftRequest.safeParse({ version: 3 }).success).toBe(false);
  });
});
