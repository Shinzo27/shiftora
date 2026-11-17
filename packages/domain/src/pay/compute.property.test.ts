import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { BASE_BP, computePay, price, type PayInput, type WorkedPeriod } from './compute.js';
import type { PayRules, PayRulesVersion } from './rules.js';

/**
 * W6 D3, the properties that must hold for **any** timesheet and **any** rule set — the
 * "done when" of the day: paid minutes never exceed worked minutes, splitting an entry never
 * changes pay, and so on. fast-check generates the cases and shrinks a failure to the smallest.
 */

const MINUTE = 60_000;
const ZONES = ['Asia/Kolkata', 'Asia/Kathmandu', 'Europe/London', 'America/New_York'];
// Around the London and New York autumn clock changes, so DST days are in the mix.
const EPOCH = Date.UTC(2026, 9, 20); // 20 Oct 2026

const time = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.constantFrom(0, 15, 30, 45))
  .map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

const rulesArb: fc.Arbitrary<PayRules> = fc.record({
  overtime: fc.uniqueArray(
    fc.oneof(
      fc.record({
        period: fc.constant('day' as const),
        thresholdMinutes: fc.integer({ min: 60, max: 1_200 }),
        multiplier: fc.constantFrom(1.25, 1.5, 2),
      }),
      fc.record({
        period: fc.constant('week' as const),
        thresholdMinutes: fc.integer({ min: 300, max: 4_000 }),
        multiplier: fc.constantFrom(1.5, 2),
      }),
    ),
    { selector: (rule) => rule.period, maxLength: 2 },
  ),
  nightPremium: fc.option(
    fc
      .record({ startLocal: time, endLocal: time, multiplier: fc.constantFrom(1.1, 1.25, 1.5) })
      .filter((night) => night.startLocal !== night.endLocal),
    { nil: null },
  ),
  breaks: fc
    .uniqueArray(
      fc
        .record({
          afterMinutes: fc.integer({ min: 60, max: 600 }),
          deductMinutes: fc.integer({ min: 5, max: 60 }),
        })
        .filter((rule) => rule.deductMinutes < rule.afterMinutes),
      { selector: (rule) => rule.afterMinutes, maxLength: 2 },
    )
    .map((rules) => [...rules]),
  rounding: fc.option(
    fc.record({
      toMinutes: fc.constantFrom(
        1 as const,
        5 as const,
        6 as const,
        10 as const,
        15 as const,
        30 as const,
      ),
      mode: fc.constantFrom('nearest' as const, 'up' as const, 'down' as const),
    }),
    { nil: null },
  ),
});

/** Non-overlapping periods in one zone, on whole minutes, as a real person's week might be. */
const periodsArb = (zone: string): fc.Arbitrary<WorkedPeriod[]> =>
  fc
    .array(
      fc.record({
        gap: fc.integer({ min: 0, max: 36 * 60 }),
        length: fc.integer({ min: 0, max: 16 * 60 }),
      }),
      { maxLength: 8 },
    )
    .map((items) => {
      let cursor = EPOCH;
      return items.map((item, index) => {
        const startsAt = new Date(cursor + item.gap * MINUTE);
        const endsAt = new Date(startsAt.getTime() + item.length * MINUTE);
        cursor = endsAt.getTime();
        return { id: `p${index}`, startsAt, endsAt, timezone: zone };
      });
    });

const inputArb: fc.Arbitrary<PayInput> = fc.constantFrom(...ZONES).chain((zone) =>
  fc.record({
    periods: periodsArb(zone),
    versions: fc.oneof(
      fc.constant([] as PayRulesVersion[]),
      rulesArb.map((rules) => [{ version: 1, effectiveFrom: '2026-01-01', rules }]),
    ),
    hourlyRateMinor: fc.integer({ min: 0, max: 200_000 }),
  }),
);

const RUNS = { numRuns: 400 };

describe('computePay — properties', () => {
  it('paid minutes never exceed worked minutes, and are worked − breaks exactly', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computePay(input);
        expect(result.paidMinutes).toBeLessThanOrEqual(result.workedMinutes);
        expect(result.paidMinutes).toBe(result.workedMinutes - result.breakMinutes);
      }),
      RUNS,
    );
  });

  it('the lines add up to the totals: minutes and money', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computePay(input);
        expect(result.lines.reduce((sum, line) => sum + line.minutes, 0)).toBe(result.paidMinutes);
        expect(result.lines.reduce((sum, line) => sum + line.amountMinor, 0)).toBe(
          result.amountMinor,
        );
        for (const line of result.lines) expect(line.minutes).toBeGreaterThan(0);
      }),
      RUNS,
    );
  });

  it('nobody is paid less than base for any minute (premiums only ever add)', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computePay(input);
        for (const line of result.lines) {
          expect(line.multiplierBp).toBeGreaterThanOrEqual(BASE_BP);
          expect(line.amountMinor).toBeGreaterThanOrEqual(
            price(line.minutes, input.hourlyRateMinor, BASE_BP),
          );
        }
      }),
      RUNS,
    );
  });

  it('the order periods arrive in never matters', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const reversed = { ...input, periods: [...input.periods].reverse() };
        expect(computePay(reversed)).toEqual(computePay(input));
      }),
      RUNS,
    );
  });

  it('splitting an entry in two at any minute never changes pay (no breaks, no rounding)', () => {
    const noBreaks = inputArb
      .map((input) => ({
        ...input,
        versions: input.versions.map((version) => ({
          ...version,
          rules: { ...version.rules, breaks: [], rounding: null },
        })),
      }))
      .filter((input) =>
        input.periods.some((p) => p.endsAt.getTime() - p.startsAt.getTime() > MINUTE),
      );

    fc.assert(
      fc.property(noBreaks, fc.nat(), fc.nat(), (input, which, at) => {
        const long = input.periods.filter(
          (p) => p.endsAt.getTime() - p.startsAt.getTime() > MINUTE,
        );
        const period = long[which % long.length]!;
        const minutes = (period.endsAt.getTime() - period.startsAt.getTime()) / MINUTE;
        const cut = new Date(period.startsAt.getTime() + (1 + (at % (minutes - 1))) * MINUTE);
        const split = {
          ...input,
          periods: [
            ...input.periods.filter((p) => p !== period),
            { ...period, id: `${period.id}a`, endsAt: cut },
            { ...period, id: `${period.id}b`, startsAt: cut },
          ],
        };
        expect(computePay(split)).toEqual(computePay(input));
      }),
      RUNS,
    );
  });

  it('without rules, everything is regular at base and costs minutes × rate', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const result = computePay({ ...input, versions: [] });
        for (const line of result.lines) {
          expect(line).toMatchObject({ category: 'regular', night: false, multiplierBp: BASE_BP });
        }
        expect(result.breakMinutes).toBe(0);
      }),
      RUNS,
    );
  });

  it('raising an overtime threshold never adds overtime', () => {
    fc.assert(
      fc.property(inputArb, fc.integer({ min: 1, max: 600 }), (input, raise) => {
        const overtime = (i: PayInput) =>
          computePay(i)
            .lines.filter((line) => line.category === 'overtime')
            .reduce((sum, line) => sum + line.minutes, 0);
        const raised = {
          ...input,
          versions: input.versions.map((version) => ({
            ...version,
            rules: {
              ...version.rules,
              overtime: version.rules.overtime.map((rule) => ({
                ...rule,
                thresholdMinutes: rule.thresholdMinutes + raise,
              })),
            },
          })),
        };
        expect(overtime(raised)).toBeLessThanOrEqual(overtime(input));
      }),
      RUNS,
    );
  });

  it('a night premium never lowers pay', () => {
    fc.assert(
      fc.property(inputArb, (input) => {
        const withoutNight = {
          ...input,
          versions: input.versions.map((version) => ({
            ...version,
            rules: { ...version.rules, nightPremium: null },
          })),
        };
        expect(computePay(input).amountMinor).toBeGreaterThanOrEqual(
          computePay(withoutNight).amountMinor,
        );
      }),
      RUNS,
    );
  });
});
