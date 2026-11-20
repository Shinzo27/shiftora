import { describe, expect, it } from 'vitest';

import { dayRange, timeOffLabel } from './time-off';

describe('dayRange', () => {
  it('runs from local midnight on the first day to local midnight after the last', () => {
    expect(dayRange('2026-12-12', '2026-12-14', 'Asia/Kolkata')).toEqual({
      startsAt: '2026-12-11T18:30:00.000Z',
      endsAt: '2026-12-14T18:30:00.000Z',
    });
  });

  it('follows the wall clock across a DST change, not 24-hour steps', () => {
    // London leaves summer time on 25 Oct 2026: the 24th starts at 23:00Z, the 26th ends at 00:00Z.
    expect(dayRange('2026-10-24', '2026-10-25', 'Europe/London')).toEqual({
      startsAt: '2026-10-23T23:00:00.000Z',
      endsAt: '2026-10-26T00:00:00.000Z',
    });
  });
});

describe('timeOffLabel', () => {
  const zone = 'Asia/Kolkata';

  it('names whole days on the branch calendar', () => {
    expect(timeOffLabel(dayRange('2026-12-12', '2026-12-12', zone), zone)).toBe('12 Dec');
    expect(timeOffLabel(dayRange('2026-12-12', '2026-12-14', zone), zone)).toBe('12 Dec – 14 Dec');
  });

  it('shows times when it does not start and end at midnight', () => {
    expect(
      timeOffLabel(
        { startsAt: '2026-12-12T08:30:00.000Z', endsAt: '2026-12-13T03:30:00.000Z' },
        zone,
      ),
    ).toBe('12 Dec 14:00 – 13 Dec 09:00');
  });
});
