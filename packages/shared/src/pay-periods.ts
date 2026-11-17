import { MAX_PERIOD_DAYS, periodDays } from '@shiftora/domain';
import { z } from 'zod';

import { localDate } from './scheduling.js';

/** Pay periods and payroll on the wire (W6 D4–D5). */

export const createPayPeriod = z
  .object({ startsOn: localDate, endsOn: localDate })
  .superRefine((body, ctx) => {
    if (body.endsOn < body.startsOn) {
      ctx.addIssue({ code: 'custom', path: ['endsOn'], message: 'Ends before it starts' });
    } else if (periodDays(body.startsOn, body.endsOn) > MAX_PERIOD_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: `A pay period is at most ${MAX_PERIOD_DAYS} days`,
      });
    }
  });
export type CreatePayPeriod = z.output<typeof createPayPeriod>;

export const payPeriodStatus = z.enum(['open', 'calculating', 'approved']);

/** What still stands in the way of approving (owner's rule: both must be zero). */
export const payPeriodReadiness = z.object({
  /** Clocked in, never clocked out. */
  openPunches: z.number().int(),
  /** Flagged (outside the fence, poor accuracy…) and not reviewed by a manager yet. */
  unreviewedFlags: z.number().int(),
  /** Disputed by a manager: left out of pay. */
  disputed: z.number().int(),
});
export type PayPeriodReadiness = z.output<typeof payPeriodReadiness>;

export const payPeriodView = z.object({
  id: z.uuid(),
  startsOn: z.string(),
  endsOn: z.string(),
  status: payPeriodStatus,
  approvedAt: z.iso.datetime().nullable(),
  calculatedAt: z.iso.datetime().nullable(),
  totals: z
    .object({
      employees: z.number().int(),
      paidMinutes: z.number().int(),
      amountMinor: z.number().int(),
    })
    .nullable(),
  /** Present while the period is open. */
  readiness: payPeriodReadiness.nullable(),
});
export type PayPeriodView = z.output<typeof payPeriodView>;

export const payrollLine = z.object({
  date: z.string(),
  category: z.enum(['regular', 'overtime']),
  night: z.boolean(),
  minutes: z.number().int(),
  multiplierBp: z.number().int(),
  amountMinor: z.number().int(),
});

/** One person's pay for the period: the totals an accountant reads, and the days behind them. */
export const payrollEmployee = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  rateMinor: z.number().int(),
  currency: z.string(),
  regularMinutes: z.number().int(),
  overtimeMinutes: z.number().int(),
  nightMinutes: z.number().int(),
  amountMinor: z.number().int(),
  lines: z.array(payrollLine),
});
export type PayrollEmployee = z.output<typeof payrollEmployee>;
