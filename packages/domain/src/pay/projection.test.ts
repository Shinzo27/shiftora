import { describe, expect, it } from 'vitest';

import { toInstant } from '../time/zoned.js';
import type { WorkedPeriod } from './compute.js';
import { projectCost } from './projection.js';
import { NO_PAY_RULES, type PayRulesVersion } from './rules.js';

const IST = 'Asia/Kolkata';
const shift = (date: string, from: string, to: string, breakMinutes = 0): WorkedPeriod => ({
  id: `${date}-${from}`,
  startsAt: toInstant(date, from, IST),
  endsAt: toInstant(date, to, IST),
  timezone: IST,
  breakMinutes,
});
const weekly: PayRulesVersion[] = [
  {
    version: 1,
    effectiveFrom: '2026-01-01',
    rules: {
      ...NO_PAY_RULES,
      overtime: [{ period: 'week', thresholdMinutes: 2400, multiplier: 1.5 }],
      // The rules' automatic break must not apply to a planned shift with its own break.
      breaks: [{ afterMinutes: 300, deductMinutes: 60 }],
    },
  },
];

describe('projectCost', () => {
  it('prices planned shifts with their own unpaid break, not the punch rule', () => {
    const cost = projectCost(
      [
        {
          employeeId: 'asha',
          hourlyRateMinor: 30_000,
          shifts: [shift('2026-11-30', '09:00', '17:00', 30)],
          otherShifts: [],
        },
      ],
      weekly,
    );
    expect(cost).toEqual({
      people: [{ employeeId: 'asha', paidMinutes: 450, overtimeMinutes: 0, costMinor: 225_000 }],
      paidMinutes: 450,
      overtimeMinutes: 0,
      costMinor: 225_000,
    });
  });

  it('charges a schedule the overtime it causes, given hours elsewhere that week', () => {
    // 36 h at Bandra on Mon–Thu, then 8 h here on Friday: the last 4 h cross 40 h → overtime.
    const elsewhere = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'].map((d) =>
      shift(d, '08:00', '17:00'),
    );
    const cost = projectCost(
      [
        {
          employeeId: 'asha',
          hourlyRateMinor: 30_000,
          shifts: [shift('2026-12-04', '09:00', '17:00')],
          otherShifts: elsewhere,
        },
      ],
      weekly,
    );
    expect(cost.people[0]).toEqual({
      employeeId: 'asha',
      paidMinutes: 480,
      overtimeMinutes: 240,
      costMinor: 4 * 30_000 + 4 * 45_000,
    });
  });

  it('adds people up', () => {
    const cost = projectCost(
      [
        {
          employeeId: 'a',
          hourlyRateMinor: 30_000,
          shifts: [shift('2026-12-01', '09:00', '13:00')],
          otherShifts: [],
        },
        {
          employeeId: 'b',
          hourlyRateMinor: 20_000,
          shifts: [shift('2026-12-01', '09:00', '11:00')],
          otherShifts: [],
        },
      ],
      [],
    );
    expect(cost).toMatchObject({ paidMinutes: 360, costMinor: 120_000 + 40_000 });
  });

  it("two branches' shares add up to the person's real pay: nothing counted twice", () => {
    const bandra = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'].map((d) =>
      shift(d, '08:00', '17:00'),
    );
    const andheri = [shift('2026-12-04', '08:00', '17:00')];
    const person = { employeeId: 'asha', hourlyRateMinor: 30_000 };
    const andheriCost = projectCost([{ ...person, shifts: andheri, otherShifts: bandra }], weekly);
    const bandraCost = projectCost([{ ...person, shifts: bandra, otherShifts: andheri }], weekly);
    const whole = projectCost(
      [{ ...person, shifts: [...bandra, ...andheri], otherShifts: [] }],
      weekly,
    );

    // Mon–Thu (Bandra) come first: all regular. Friday (Andheri) crosses 40 h: 5 h overtime.
    expect(bandraCost.overtimeMinutes).toBe(0);
    expect(andheriCost.overtimeMinutes).toBe(300);
    expect(andheriCost.costMinor + bandraCost.costMinor).toBe(whole.costMinor);
  });
});
