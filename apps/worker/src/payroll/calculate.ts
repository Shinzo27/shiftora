import { and, asc, eq, inArray, schema, sql, type Database } from '@shiftora/db';
import {
  computePay,
  linesInPeriod,
  payWindow,
  type PayRulesVersion,
  type WorkedPeriod,
} from '@shiftora/domain';

import { setOrg } from '../notifications/fan-out.js';
import type { OutboxEvent } from '../outbox-relay.js';

export interface PayrollResult {
  /** False when there was nothing to do (already calculated, or the period is gone). */
  calculated: boolean;
  employees: number;
  lines: number;
  amountMinor: number;
}

const NOTHING: PayrollResult = { calculated: false, employees: 0, lines: 0, amountMinor: 0 };

/**
 * `pay_period.approved` → the period's lines (W6 D4). One transaction under the org's context:
 *
 *   1. the period must be `calculating` (an owner approved it); anything else is a no-op, so a
 *      replayed job does nothing;
 *   2. load the closed, undisputed punches from the day before the period's first week to its end
 *      (`payWindow`: weekly overtime needs the whole week, an overnight shift its evening);
 *   3. `computePay` per person with the org's pay-rule versions and their own rate, keeping the
 *      lines dated inside the period (`linesInPeriod`);
 *   4. replace the period's lines, write the totals, and mark it `approved`.
 *
 * Owner's rules: disputed punches are not paid; a punch is paid at the rate on the employee's
 * record when the period is calculated.
 */
export async function calculatePayroll(db: Database, event: OutboxEvent): Promise<PayrollResult> {
  const periodId = (event.payload as { payPeriodId?: unknown } | null)?.payPeriodId;
  if (typeof periodId !== 'string') return NOTHING;

  return db.transaction(async (tx) => {
    await setOrg(tx, event.orgId);
    const [period] = await tx
      .select()
      .from(schema.payPeriods)
      .where(and(eq(schema.payPeriods.orgId, event.orgId), eq(schema.payPeriods.id, periodId)))
      .for('update');
    if (!period || period.status !== 'calculating') return NOTHING;

    const window = payWindow(period.startsOn, period.endsOn);
    const punches = await tx.execute<{
      id: string;
      employee_id: string;
      clock_in_at: Date;
      clock_out_at: Date;
      timezone: string;
    }>(sql`
      select te.id, te.employee_id, te.clock_in_at, te.clock_out_at, l.timezone
      from time_entries te
      join locations l on l.org_id = te.org_id and l.id = te.location_id
      where te.org_id = ${event.orgId}
        and te.clock_out_at is not null
        and te.review_decision is distinct from 'disputed'
        and (te.clock_in_at at time zone l.timezone)::date
            between ${window.loadFrom}::date and ${window.loadTo}::date
      order by te.employee_id, te.clock_in_at`);

    const versions: PayRulesVersion[] = await tx
      .select({
        version: schema.payRules.version,
        effectiveFrom: schema.payRules.effectiveFrom,
        rules: schema.payRules.rules,
      })
      .from(schema.payRules)
      .where(eq(schema.payRules.orgId, event.orgId))
      .orderBy(asc(schema.payRules.version));

    const byEmployee = new Map<string, WorkedPeriod[]>();
    for (const punch of punches.rows) {
      const list = byEmployee.get(punch.employee_id) ?? [];
      list.push({
        id: punch.id,
        startsAt: new Date(punch.clock_in_at),
        endsAt: new Date(punch.clock_out_at),
        timezone: punch.timezone,
      });
      byEmployee.set(punch.employee_id, list);
    }
    const people =
      byEmployee.size === 0
        ? []
        : await tx
            .select({
              id: schema.employees.id,
              rate: schema.employees.hourlyRateMinor,
              currency: schema.employees.currency,
            })
            .from(schema.employees)
            .where(
              and(
                eq(schema.employees.orgId, event.orgId),
                inArray(schema.employees.id, [...byEmployee.keys()]),
              ),
            );

    await tx
      .delete(schema.timesheetLines)
      .where(
        and(
          eq(schema.timesheetLines.orgId, event.orgId),
          eq(schema.timesheetLines.payPeriodId, periodId),
        ),
      );

    let lineCount = 0;
    let paidMinutes = 0;
    let amountMinor = 0;
    let paidPeople = 0;
    for (const person of people) {
      const result = computePay({
        periods: byEmployee.get(person.id) ?? [],
        versions,
        hourlyRateMinor: person.rate,
      });
      const lines = linesInPeriod(result.lines, period.startsOn, period.endsOn);
      if (lines.length === 0) continue;
      paidPeople += 1;
      await tx.insert(schema.timesheetLines).values(
        lines.map((line) => ({
          orgId: event.orgId,
          payPeriodId: periodId,
          employeeId: person.id,
          date: line.date,
          category: line.category,
          night: line.night,
          minutes: line.minutes,
          multiplierBp: line.multiplierBp,
          rateMinor: person.rate,
          amountMinor: line.amountMinor,
          currency: person.currency,
        })),
      );
      lineCount += lines.length;
      paidMinutes += lines.reduce((sum, line) => sum + line.minutes, 0);
      amountMinor += lines.reduce((sum, line) => sum + line.amountMinor, 0);
    }

    await tx
      .update(schema.payPeriods)
      .set({
        status: 'approved',
        calculatedAt: new Date(),
        employees: paidPeople,
        paidMinutes,
        amountMinor,
      })
      .where(eq(schema.payPeriods.id, periodId));

    return { calculated: true, employees: paidPeople, lines: lineCount, amountMinor };
  });
}
