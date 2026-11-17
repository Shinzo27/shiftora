import { describe, expect, it } from 'vitest';

import { toInstant } from '../time/zoned.js';
import { computePay, type PayLine, type WorkedPeriod } from './compute.js';
import { NO_PAY_RULES, type PayRules, type PayRulesVersion } from './rules.js';

/**
 * W6 D3 by example: overtime (daily, weekly, never counted twice), the night premium across
 * midnight, and premiums adding on base (owner's decision: 1 + 0.5 + 0.25 = 1.75×).
 */

const IST = 'Asia/Kolkata';
const RATE = 30_000; // ₹300/h

function worked(date: string, from: string, to: string, endDate = date): WorkedPeriod {
  return {
    id: `${date}-${from}`,
    startsAt: toInstant(date, from, IST),
    endsAt: toInstant(endDate, to, IST),
    timezone: IST,
  };
}

const rulesFrom = (rules: Partial<PayRules>, effectiveFrom = '2026-01-01'): PayRulesVersion[] => [
  { version: 1, effectiveFrom, rules: { ...NO_PAY_RULES, ...rules } },
];

const daily = { period: 'day' as const, thresholdMinutes: 540, multiplier: 1.5 };
const weekly = { period: 'week' as const, thresholdMinutes: 2880, multiplier: 1.5 };
const night = { startLocal: '22:00', endLocal: '06:00', multiplier: 1.25 };

/** Minutes per (category, multiplier), across the whole result. */
function totals(lines: PayLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    const key = `${line.category}@${line.multiplierBp / 10_000}${line.night ? ' night' : ''}`;
    out[key] = (out[key] ?? 0) + line.minutes;
  }
  return out;
}

describe('daily overtime', () => {
  it('pays the minutes beyond the threshold at the overtime rate', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '08:00', '19:00')], // 11 h
      versions: rulesFrom({ overtime: [daily] }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 540, 'overtime@1.5': 120 });
    expect(result.amountMinor).toBe(9 * 30_000 + 2 * 45_000);
  });

  it('counts the whole local day, across two punches', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '07:00', '12:00'), worked('2026-12-01', '13:00', '19:00')],
      versions: rulesFrom({ overtime: [daily] }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 540, 'overtime@1.5': 120 });
  });

  it('starts again at midnight: an overnight shift is two days', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '16:00', '06:00', '2026-12-02')], // 8 h + 6 h
      versions: rulesFrom({ overtime: [daily] }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 840 });
  });
});

describe('weekly overtime', () => {
  it('counts Monday to Sunday', () => {
    // Six 9-hour days with no daily rule: 54 h against 48 h → 6 h overtime, on Saturday.
    const days = [
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ];
    const result = computePay({
      periods: days.map((day) => worked(day, '08:00', '17:00')),
      versions: rulesFrom({ overtime: [weekly] }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 2880, 'overtime@1.5': 360 });
    expect(result.lines.filter((l) => l.category === 'overtime').map((l) => l.date)).toEqual([
      '2026-12-05',
    ]);
  });

  it('never counts a minute twice: six 10-hour days at 9 h/day and 48 h/week is 12 h, not 16', () => {
    const days = [
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ];
    const result = computePay({
      periods: days.map((day) => worked(day, '08:00', '18:00')),
      versions: rulesFrom({ overtime: [daily, weekly] }),
      hourlyRateMinor: RATE,
    });
    const overtime = result.lines
      .filter((line) => line.category === 'overtime')
      .reduce((sum, line) => sum + line.minutes, 0);
    expect(overtime).toBe(12 * 60);
    expect(result.paidMinutes).toBe(60 * 60);
  });

  it('a new week starts fresh on Monday', () => {
    const result = computePay({
      periods: [worked('2026-12-06', '00:00', '23:00'), worked('2026-12-07', '08:00', '17:00')],
      versions: rulesFrom({ overtime: [{ ...weekly, thresholdMinutes: 600 }] }),
      hourlyRateMinor: RATE,
    });
    // Sunday: 23 h against 10 h → 13 h overtime. Monday (new week): all regular.
    const monday = result.lines.filter((line) => line.date === '2026-12-07');
    expect(monday.map((line) => line.category)).toEqual(['regular']);
  });

  it('a week uses the threshold in force on its Monday, even if rules change mid-week', () => {
    const versions: PayRulesVersion[] = [
      { version: 1, effectiveFrom: '2026-01-01', rules: { ...NO_PAY_RULES, overtime: [weekly] } },
      {
        version: 2,
        effectiveFrom: '2026-12-03', // a Thursday
        rules: { ...NO_PAY_RULES, overtime: [{ ...weekly, thresholdMinutes: 600 }] },
      },
    ];
    const result = computePay({
      periods: [worked('2026-12-04', '08:00', '20:00')], // Friday, 12 h
      versions,
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 720 }); // still 48 h for this week
  });
});

describe('night premium', () => {
  it('applies inside the window, across midnight, and not outside it', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '20:00', '08:00', '2026-12-02')],
      versions: rulesFrom({ nightPremium: night }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 240, 'regular@1.25 night': 480 });
    // 20:00–22:00 and 06:00–08:00 plain; 22:00–06:00 at 1.25×, on both dates.
    expect(result.lines.map((l) => [l.date, l.night, l.minutes])).toEqual([
      ['2026-12-01', false, 120],
      ['2026-12-01', true, 120],
      ['2026-12-02', false, 120],
      ['2026-12-02', true, 360],
    ]);
  });

  it('a window inside one day (00:00–05:00) works too', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '03:00', '09:00')],
      versions: rulesFrom({ nightPremium: { ...night, startLocal: '00:00', endLocal: '05:00' } }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({ 'regular@1': 240, 'regular@1.25 night': 120 });
  });

  it('overtime at night adds both premiums: 1 + 0.5 + 0.25 = 1.75×', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '12:00', '23:30')], // 11.5 h; the last 2.5 h are overtime
      versions: rulesFrom({ overtime: [daily], nightPremium: night }),
      hourlyRateMinor: RATE,
    });
    expect(totals(result.lines)).toEqual({
      'regular@1': 540,
      'overtime@1.5': 60, // 21:00–22:00
      'overtime@1.75 night': 90, // 22:00–23:30
    });
    expect(result.amountMinor).toBe(9 * 30_000 + 45_000 + 1.5 * 52_500);
  });
});
