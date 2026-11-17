import { z } from 'zod';

import { localTime } from './employees.js';
import { localDate } from './scheduling.js';

/**
 * Pay rules on the wire (W6 D1). The shape is `PayRules` in `packages/domain/pay/rules.ts`; this
 * is what makes a rule set valid before it is stored. A saved version never changes — a new
 * version starts on a later date — so a past period always recalculates the same way.
 */

/** 1×–5×, at most two decimals (1.5, 1.25, 2): the engine works in exact basis points. */
const multiplier = z
  .number()
  .min(1, 'At least 1×')
  .max(5, 'At most 5×')
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: 'At most two decimals',
  });

const minutes = (max: number) => z.number().int().min(1).max(max);

export const overtimeRule = z.object({
  period: z.enum(['day', 'week']),
  thresholdMinutes: minutes(7 * 24 * 60),
  multiplier,
});

export const nightPremium = z
  .object({ startLocal: localTime, endLocal: localTime, multiplier })
  .refine((night) => night.startLocal !== night.endLocal, {
    path: ['endLocal'],
    message: 'The night window needs a different start and end',
  });

export const breakRule = z
  .object({ afterMinutes: minutes(24 * 60), deductMinutes: minutes(4 * 60) })
  .refine((rule) => rule.deductMinutes < rule.afterMinutes, {
    path: ['deductMinutes'],
    message: 'A break must be shorter than the work it is taken from',
  });

export const roundingRule = z.object({
  toMinutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(6),
    z.literal(10),
    z.literal(15),
    z.literal(30),
  ]),
  mode: z.enum(['nearest', 'up', 'down']),
});

export const payRules = z
  .object({
    overtime: z.array(overtimeRule).max(2).default([]),
    nightPremium: nightPremium.nullable().default(null),
    breaks: z.array(breakRule).max(5).default([]),
    rounding: roundingRule.nullable().default(null),
  })
  .superRefine((rules, ctx) => {
    const periods = rules.overtime.map((rule) => rule.period);
    if (new Set(periods).size !== periods.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['overtime'],
        message: 'At most one daily and one weekly overtime rule',
      });
    }
    const day = rules.overtime.find((rule) => rule.period === 'day');
    if (day && day.thresholdMinutes >= 24 * 60) {
      ctx.addIssue({
        code: 'custom',
        path: ['overtime'],
        message: 'A daily threshold is under 24 hours',
      });
    }
    const after = rules.breaks.map((rule) => rule.afterMinutes);
    if (new Set(after).size !== after.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['breaks'],
        message: 'Two break rules cannot start after the same length of work',
      });
    }
  });
export type PayRulesInput = z.input<typeof payRules>;
export type PayRulesData = z.output<typeof payRules>;

export const createPayRulesVersion = z.object({
  /** The local date the rules start applying (to work done on or after it). */
  effectiveFrom: localDate,
  rules: payRules,
  /** Why it changed, for whoever reads the history. */
  note: z.string().trim().max(500).optional(),
});
export type CreatePayRulesVersion = z.output<typeof createPayRulesVersion>;

export const payRulesVersionView = z.object({
  id: z.uuid(),
  version: z.number().int(),
  effectiveFrom: z.string(),
  rules: payRules,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
  createdBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type PayRulesVersionView = z.output<typeof payRulesVersionView>;

export const payRulesInForceQuery = z.object({ date: localDate });
export type PayRulesInForceQuery = z.output<typeof payRulesInForceQuery>;

/** The rules for a day, and which version they come from (null = plain hourly pay). */
export const payRulesInForceView = z.object({
  date: z.string(),
  version: z.number().int().nullable(),
  rules: payRules,
});
export type PayRulesInForceView = z.output<typeof payRulesInForceView>;
