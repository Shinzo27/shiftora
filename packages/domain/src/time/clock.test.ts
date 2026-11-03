import { describe, expect, it } from 'vitest';

import { fixedClock } from './clock.js';

describe('fixedClock', () => {
  it('always returns the given instant', () => {
    const clock = fixedClock('2026-11-09T03:30:00Z');

    expect(clock.now().toISOString()).toBe('2026-11-09T03:30:00.000Z');
    expect(clock.now().toISOString()).toBe('2026-11-09T03:30:00.000Z');
  });

  it('is not affected by callers mutating the returned Date', () => {
    const clock = fixedClock(new Date('2026-11-09T03:30:00Z'));

    clock.now().setUTCFullYear(2000);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('rejects an invalid instant', () => {
    expect(() => fixedClock('not-a-date')).toThrow(RangeError);
  });
});
