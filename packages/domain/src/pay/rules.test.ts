import { describe, expect, it } from 'vitest';

import { NO_PAY_RULES, rulesInForce, toBasisPoints, type PayRulesVersion } from './rules.js';

const v = (version: number, effectiveFrom: string, threshold: number): PayRulesVersion => ({
  version,
  effectiveFrom,
  rules: {
    ...NO_PAY_RULES,
    overtime: [{ period: 'day', thresholdMinutes: threshold, multiplier: 1.5 }],
  },
});

describe('rulesInForce', () => {
  const versions = [v(1, '2026-11-01', 540), v(2, '2026-12-01', 480)];

  it('picks the latest version that had started by that date', () => {
    expect(rulesInForce(versions, '2026-11-30').overtime[0]!.thresholdMinutes).toBe(540);
    expect(rulesInForce(versions, '2026-12-01').overtime[0]!.thresholdMinutes).toBe(480);
    expect(rulesInForce(versions, '2027-03-15').overtime[0]!.thresholdMinutes).toBe(480);
  });

  it('before the first version, and with none, pay is plain hourly', () => {
    expect(rulesInForce(versions, '2026-10-31')).toEqual(NO_PAY_RULES);
    expect(rulesInForce([], '2026-11-15')).toEqual(NO_PAY_RULES);
  });

  it('does not depend on the order versions arrive in', () => {
    expect(rulesInForce([...versions].reverse(), '2026-12-05').overtime[0]!.thresholdMinutes).toBe(
      480,
    );
  });
});

describe('toBasisPoints', () => {
  it.each([
    [1, 10_000],
    [1.5, 15_000],
    [1.25, 12_500],
    [2, 20_000],
    [1.1, 11_000],
  ])('%s× is %s basis points, exactly', (multiplier, bp) => {
    expect(toBasisPoints(multiplier)).toBe(bp);
  });
});
