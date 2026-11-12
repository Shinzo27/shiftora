import { describe, expect, it } from 'vitest';

import { matchShift, workedMinutes, type PlannableShift } from './match.js';

/** A 09:00–17:00 shift on 12 Nov 2026, Mumbai (03:30–11:30 UTC). */
const morning: PlannableShift = {
  id: 'morning',
  startsAt: new Date('2026-11-12T03:30:00.000Z'),
  endsAt: new Date('2026-11-12T11:30:00.000Z'),
};
/** 22:00–06:00 the same night. */
const night: PlannableShift = {
  id: 'night',
  startsAt: new Date('2026-11-12T16:30:00.000Z'),
  endsAt: new Date('2026-11-13T00:30:00.000Z'),
};

const at = (iso: string) => new Date(iso);

describe('matchShift', () => {
  it('matches a punch at the shift start and calls it on time', () => {
    const match = matchShift(at('2026-11-12T03:30:00.000Z'), [morning], 5);
    expect(match).toMatchObject({ state: 'on_time', lateMinutes: 0, earlyMinutes: 0 });
    expect(match.shift?.id).toBe('morning');
  });

  it('absorbs a delay inside the grace', () => {
    expect(matchShift(at('2026-11-12T03:34:00.000Z'), [morning], 5)).toMatchObject({
      state: 'on_time',
      lateMinutes: 0,
    });
  });

  it('reports lateness beyond the grace, counting only the excess', () => {
    // 09:20 against a 09:00 start with a 5-minute grace: 15 minutes late.
    expect(matchShift(at('2026-11-12T03:50:00.000Z'), [morning], 5)).toMatchObject({
      state: 'late',
      lateMinutes: 15,
      earlyMinutes: 0,
    });
  });

  it('reports an early arrival beyond the grace', () => {
    // 08:40 against 09:00 with a 5-minute grace: 15 minutes early.
    expect(matchShift(at('2026-11-12T03:10:00.000Z'), [morning], 5)).toMatchObject({
      state: 'early',
      earlyMinutes: 15,
      lateMinutes: 0,
    });
  });

  it('leaves a punch with no shift nearby unscheduled', () => {
    expect(matchShift(at('2026-11-12T14:00:00.000Z'), [morning], 5)).toEqual({
      shift: null,
      lateMinutes: 0,
      earlyMinutes: 0,
      state: 'unscheduled',
    });
  });

  it('picks the shift that is starting nearest, not the first in the list', () => {
    // 22:05 — closer to the night start (22:00) than to the morning one (09:00).
    const match = matchShift(at('2026-11-12T16:35:00.000Z'), [morning, night], 5);
    expect(match.shift?.id).toBe('night');
    expect(match.state).toBe('on_time');
  });

  it('still considers a shift a couple of hours after it began', () => {
    // 11:00 for a 09:00–17:00 shift: inside the shift, so it matches (and is late).
    const match = matchShift(at('2026-11-12T05:30:00.000Z'), [morning], 5);
    expect(match.shift?.id).toBe('morning');
    expect(match.lateMinutes).toBe(115);
  });

  it('treats a negative grace as none: two minutes past the start is late', () => {
    expect(matchShift(at('2026-11-12T03:32:00.000Z'), [morning], -10)).toMatchObject({
      state: 'late',
      lateMinutes: 2,
    });
  });
});

describe('workedMinutes', () => {
  it('is zero while the punch is open', () => {
    expect(workedMinutes(new Date('2026-11-12T03:30:00Z'), null)).toBe(0);
  });

  it('counts the span for a closed punch, and never negative', () => {
    expect(workedMinutes(new Date('2026-11-12T03:30:00Z'), new Date('2026-11-12T11:30:00Z'))).toBe(
      480,
    );
    expect(workedMinutes(new Date('2026-11-12T11:30:00Z'), new Date('2026-11-12T03:30:00Z'))).toBe(
      0,
    );
  });
});
