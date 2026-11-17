import { describe, expect, it } from 'vitest';

import { toInstant } from '../time/zoned.js';
import { computePay } from './compute.js';
import { linesInPeriod, payWindow, periodDays } from './period.js';
import { NO_PAY_RULES } from './rules.js';

const IST = 'Asia/Kolkata';
const worked = (date: string, from: string, to: string, endDate = date) => ({
  id: `${date}-${from}`,
  startsAt: toInstant(date, from, IST),
  endsAt: toInstant(endDate, to, IST),
  timezone: IST,
});

describe('pay periods', () => {
  it('counts days inclusively', () => {
    expect(periodDays('2026-12-01', '2026-12-31')).toBe(31);
    expect(periodDays('2026-12-01', '2026-12-01')).toBe(1);
  });

  it('loads from the day before the week of the start', () => {
    // 3 Dec 2026 is a Thursday; its week starts Monday 30 Nov.
    expect(payWindow('2026-12-03', '2026-12-16')).toEqual({
      loadFrom: '2026-11-29',
      loadTo: '2026-12-16',
    });
  });

  it('a period starting mid-week still applies that week’s overtime threshold', () => {
    const weekly = {
      version: 1,
      effectiveFrom: '2026-01-01',
      rules: {
        ...NO_PAY_RULES,
        overtime: [{ period: 'week' as const, thresholdMinutes: 2400, multiplier: 1.5 }],
      },
    };
    // Mon–Wed 10 h each (30 h, previous period), then Thu 12 h in this period: 42 h > 40 h.
    const periods = ['2026-11-30', '2026-12-01', '2026-12-02']
      .map((d) => worked(d, '08:00', '18:00'))
      .concat(worked('2026-12-03', '08:00', '20:00'));
    const lines = linesInPeriod(
      computePay({ periods, versions: [weekly], hourlyRateMinor: 30_000 }).lines,
      '2026-12-03',
      '2026-12-16',
    );
    expect(lines.map((l) => [l.date, l.category, l.minutes])).toEqual([
      ['2026-12-03', 'regular', 600],
      ['2026-12-03', 'overtime', 120],
    ]);
  });

  it('an overnight shift at a boundary is split between the two periods, nothing lost', () => {
    const periods = [worked('2026-11-30', '22:00', '06:00', '2026-12-01')];
    const all = computePay({ periods, versions: [], hourlyRateMinor: 30_000 }).lines;
    const november = linesInPeriod(all, '2026-11-01', '2026-11-30');
    const december = linesInPeriod(all, '2026-12-01', '2026-12-31');
    expect(november.map((l) => l.minutes)).toEqual([120]);
    expect(december.map((l) => l.minutes)).toEqual([360]);
  });
});
