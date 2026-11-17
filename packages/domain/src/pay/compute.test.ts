import { describe, expect, it } from 'vitest';

import { toInstant } from '../time/zoned.js';
import {
  breakFor,
  computePay,
  price,
  roundPunch,
  withoutBreak,
  type WorkedPeriod,
} from './compute.js';
import { NO_PAY_RULES, type PayRules, type PayRulesVersion } from './rules.js';

const IST = 'Asia/Kolkata';
const RATE = 30_000; // ₹300.00 an hour, in paise

/** A punch from local date/time to local date/time at an Indian location. */
function worked(
  date: string,
  from: string,
  to: string,
  options: { endDate?: string; zone?: string } = {},
): WorkedPeriod {
  const zone = options.zone ?? IST;
  return {
    id: `${date}-${from}`,
    startsAt: toInstant(date, from, zone),
    endsAt: toInstant(options.endDate ?? date, to, zone),
    timezone: zone,
  };
}

const version = (effectiveFrom: string, rules: Partial<PayRules>, n = 1): PayRulesVersion => ({
  version: n,
  effectiveFrom,
  rules: { ...NO_PAY_RULES, ...rules },
});

describe('computePay — plain hourly pay (no rules)', () => {
  it('pays every minute worked at the base rate, one line per day', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '09:00', '17:00'), worked('2026-12-02', '09:00', '13:30')],
      versions: [],
      hourlyRateMinor: RATE,
    });

    expect(result.lines).toEqual([
      {
        date: '2026-12-01',
        category: 'regular',
        night: false,
        minutes: 480,
        multiplierBp: 10_000,
        amountMinor: 240_000,
      },
      {
        date: '2026-12-02',
        category: 'regular',
        night: false,
        minutes: 270,
        multiplierBp: 10_000,
        amountMinor: 135_000,
      },
    ]);
    expect(result).toMatchObject({
      workedMinutes: 750,
      breakMinutes: 0,
      paidMinutes: 750,
      amountMinor: 375_000,
    });
  });

  it('an overnight shift is split at local midnight: each minute counts on its own day', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '22:00', '06:00', { endDate: '2026-12-02' })],
      versions: [],
      hourlyRateMinor: RATE,
    });

    expect(result.lines.map((line) => [line.date, line.minutes])).toEqual([
      ['2026-12-01', 120],
      ['2026-12-02', 360],
    ]);
  });

  it('a clock-out before (or at) the clock-in pays nothing', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '17:00', '09:00')],
      versions: [],
      hourlyRateMinor: RATE,
    });
    expect(result).toMatchObject({ lines: [], paidMinutes: 0, amountMinor: 0 });
  });

  it('periods in any order give the same answer', () => {
    const periods = [
      worked('2026-12-02', '09:00', '17:00'),
      worked('2026-12-01', '09:00', '17:00'),
    ];
    expect(computePay({ periods, versions: [], hourlyRateMinor: RATE })).toEqual(
      computePay({ periods: [...periods].reverse(), versions: [], hourlyRateMinor: RATE }),
    );
  });
});

describe('rounding punches', () => {
  it('rounds on the location’s wall clock, not UTC (Nepal is UTC+05:45)', () => {
    // 09:07 in Kathmandu is 03:22 UTC. Rounding down to 30 minutes in UTC would give 03:00 —
    // 08:45 on the clinic's clock. On the wall clock it is 09:00, as the manager expects.
    const kathmandu = 'Asia/Kathmandu';
    const punch = toInstant('2026-12-01', '09:07', kathmandu);
    const rounded = roundPunch(punch, kathmandu, { toMinutes: 30, mode: 'down' });
    expect(rounded).toEqual(toInstant('2026-12-01', '09:00', kathmandu));
  });

  it.each([
    ['nearest', '09:07', '09:05'],
    ['nearest', '09:08', '09:10'],
    ['up', '09:01', '09:05'],
    ['down', '09:04', '09:00'],
  ] as const)('%s on a 5-minute grid: %s → %s', (mode, from, to) => {
    expect(roundPunch(toInstant('2026-12-01', from, IST), IST, { toMinutes: 5, mode })).toEqual(
      toInstant('2026-12-01', to, IST),
    );
  });

  it('without a rule, seconds round to the nearest whole minute', () => {
    const punch = new Date(toInstant('2026-12-01', '09:00', IST).getTime() + 40_000);
    expect(roundPunch(punch, IST, null)).toEqual(toInstant('2026-12-01', '09:01', IST));
  });

  it('the rules of the day the work started decide the rounding', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '09:07', '17:02')],
      versions: [version('2026-12-01', { rounding: { toMinutes: 15, mode: 'nearest' } })],
      hourlyRateMinor: RATE,
    });
    expect(result.workedMinutes).toBe(480); // 09:00 to 17:00
  });
});

describe('breaks', () => {
  const rules = [
    { afterMinutes: 360, deductMinutes: 30 },
    { afterMinutes: 540, deductMinutes: 45 },
  ];

  it('takes the break of the longest rule the stretch is longer than', () => {
    expect(breakFor(360, rules)).toBe(0); // exactly 6 h: not longer
    expect(breakFor(361, rules)).toBe(30);
    expect(breakFor(600, rules)).toBe(45);
    expect(breakFor(600, [])).toBe(0);
  });

  it('comes out of the middle of the stretch', () => {
    const start = toInstant('2026-12-01', '09:00', IST);
    const end = toInstant('2026-12-01', '17:00', IST);
    const [first, second] = withoutBreak(start, end, 30);
    expect(first).toEqual({ start, end: toInstant('2026-12-01', '12:45', IST) });
    expect(second).toEqual({ start: toInstant('2026-12-01', '13:15', IST), end });
  });

  it('is unpaid: paid = worked − break', () => {
    const result = computePay({
      periods: [worked('2026-12-01', '09:00', '17:00')],
      versions: [version('2026-11-01', { breaks: rules })],
      hourlyRateMinor: RATE,
    });
    expect(result).toMatchObject({ workedMinutes: 480, breakMinutes: 30, paidMinutes: 450 });
    expect(result.amountMinor).toBe(225_000);
  });
});

describe('versions and dates', () => {
  it('each period is paid under the rules of its own day', () => {
    const versions = [
      version('2026-11-01', {}, 1),
      version('2026-12-01', { breaks: [{ afterMinutes: 360, deductMinutes: 60 }] }, 2),
    ];
    const result = computePay({
      periods: [worked('2026-11-30', '09:00', '17:00'), worked('2026-12-01', '09:00', '17:00')],
      versions,
      hourlyRateMinor: RATE,
    });
    expect(result.lines.map((line) => [line.date, line.minutes])).toEqual([
      ['2026-11-30', 480],
      ['2026-12-01', 420],
    ]);
  });

  it('a night across the London clock change pays the hours really worked', () => {
    // 25 Oct 2026: clocks go back at 02:00, so 22:00 to 06:00 is nine hours, not eight.
    const result = computePay({
      periods: [
        worked('2026-10-24', '22:00', '06:00', { endDate: '2026-10-25', zone: 'Europe/London' }),
      ],
      versions: [],
      hourlyRateMinor: RATE,
    });
    expect(result.paidMinutes).toBe(540);
    expect(result.lines.map((line) => [line.date, line.minutes])).toEqual([
      ['2026-10-24', 120],
      ['2026-10-25', 420],
    ]);
  });
});

describe('price', () => {
  it('is integer arithmetic, rounded half up, never a float of money', () => {
    expect(price(60, 30_000, 10_000)).toBe(30_000);
    expect(price(1, 30_000, 10_000)).toBe(500);
    expect(price(1, 10_001, 15_000)).toBe(250); // 250.025 → 250
    expect(price(7, 333, 17_500)).toBe(68); // 67.9875 → 68
  });
});
