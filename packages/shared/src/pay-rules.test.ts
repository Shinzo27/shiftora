import { describe, expect, it } from 'vitest';

import { createPayRulesVersion, payRules } from './pay-rules.js';

const full = {
  overtime: [
    { period: 'day', thresholdMinutes: 540, multiplier: 1.5 },
    { period: 'week', thresholdMinutes: 2880, multiplier: 1.5 },
  ],
  nightPremium: { startLocal: '22:00', endLocal: '06:00', multiplier: 1.25 },
  breaks: [{ afterMinutes: 360, deductMinutes: 30 }],
  rounding: { toMinutes: 5, mode: 'nearest' },
};

describe('payRules', () => {
  it('accepts a full rule set, and an empty one becomes plain hourly pay', () => {
    expect(payRules.parse(full)).toEqual(full);
    expect(payRules.parse({})).toEqual({
      overtime: [],
      nightPremium: null,
      breaks: [],
      rounding: null,
    });
  });

  it('refuses two daily overtime rules, and a daily threshold of a whole day', () => {
    expect(
      payRules.safeParse({
        overtime: [
          { period: 'day', thresholdMinutes: 480, multiplier: 1.5 },
          { period: 'day', thresholdMinutes: 600, multiplier: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      payRules.safeParse({ overtime: [{ period: 'day', thresholdMinutes: 1440, multiplier: 2 }] })
        .success,
    ).toBe(false);
  });

  it.each([0.9, 5.5, 1.333])('refuses a %s× multiplier', (multiplier) => {
    expect(
      payRules.safeParse({ overtime: [{ period: 'week', thresholdMinutes: 2880, multiplier }] })
        .success,
    ).toBe(false);
  });

  it('refuses an empty night window, a break as long as the work, and an odd rounding grid', () => {
    expect(
      payRules.safeParse({
        nightPremium: { startLocal: '22:00', endLocal: '22:00', multiplier: 1.25 },
      }).success,
    ).toBe(false);
    expect(payRules.safeParse({ breaks: [{ afterMinutes: 30, deductMinutes: 30 }] }).success).toBe(
      false,
    );
    expect(payRules.safeParse({ rounding: { toMinutes: 7, mode: 'up' } }).success).toBe(false);
  });

  it('a version needs a real date', () => {
    expect(
      createPayRulesVersion.safeParse({ effectiveFrom: '2026-02-30', rules: {} }).success,
    ).toBe(false);
  });
});
