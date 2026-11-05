import { describe, expect, it } from 'vitest';

import { addSeconds } from './duration.js';

describe('addSeconds', () => {
  it('adds elapsed seconds', () => {
    expect(addSeconds(new Date('2026-11-05T10:00:00Z'), 900).toISOString()).toBe(
      '2026-11-05T10:15:00.000Z',
    );
  });

  it('is elapsed time, so it ignores DST (London clocks went back on 2026-10-25)', () => {
    const beforeFallBack = new Date('2026-10-24T23:00:00Z'); // 00:00 BST, Oct 25 local
    expect(addSeconds(beforeFallBack, 24 * 3600).toISOString()).toBe('2026-10-25T23:00:00.000Z');
  });

  it('does not mutate the input', () => {
    const start = new Date('2026-11-05T10:00:00Z');
    addSeconds(start, 60);
    expect(start.toISOString()).toBe('2026-11-05T10:00:00.000Z');
  });

  it('rejects non-finite input', () => {
    expect(() => addSeconds(new Date(), Number.NaN)).toThrow(RangeError);
  });
});
