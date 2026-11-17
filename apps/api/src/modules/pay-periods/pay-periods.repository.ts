import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, schema, sql } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { payPeriods, timesheetLines, employees } = schema;

export type PayPeriodRecord = typeof payPeriods.$inferSelect;

@Injectable()
export class PayPeriodsRepository {
  constructor(private readonly context: RequestContext) {}

  async create(startsOn: string, endsOn: string): Promise<PayPeriodRecord> {
    const [row] = await this.context.tx
      .insert(payPeriods)
      .values({ orgId: this.context.orgId, startsOn, endsOn, createdBy: this.context.userId })
      .returning();
    return row!;
  }

  async list(): Promise<PayPeriodRecord[]> {
    return this.context.tx
      .select()
      .from(payPeriods)
      .where(eq(payPeriods.orgId, this.context.orgId))
      .orderBy(desc(payPeriods.startsOn));
  }

  async findById(id: string): Promise<PayPeriodRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(payPeriods)
      .where(and(eq(payPeriods.orgId, this.context.orgId), eq(payPeriods.id, id)));
    return row ?? null;
  }

  /** Open → calculating, only if still open: two owners approving at once approve once. */
  async markApproved(id: string): Promise<PayPeriodRecord | null> {
    const [row] = await this.context.tx
      .update(payPeriods)
      .set({ status: 'calculating', approvedAt: new Date(), approvedBy: this.context.userId })
      .where(
        and(
          eq(payPeriods.orgId, this.context.orgId),
          eq(payPeriods.id, id),
          eq(payPeriods.status, 'open'),
        ),
      )
      .returning();
    return row ?? null;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(payPeriods)
      .where(and(eq(payPeriods.orgId, this.context.orgId), eq(payPeriods.id, id)));
  }

  /** The period's lines with each person's name, ordered by person then day. */
  async lines(periodId: string) {
    return this.context.tx
      .select({ line: timesheetLines, name: employees.name })
      .from(timesheetLines)
      .innerJoin(
        employees,
        and(eq(employees.orgId, timesheetLines.orgId), eq(employees.id, timesheetLines.employeeId)),
      )
      .where(
        and(eq(timesheetLines.orgId, this.context.orgId), eq(timesheetLines.payPeriodId, periodId)),
      )
      .orderBy(asc(employees.name), asc(timesheetLines.employeeId), asc(timesheetLines.date));
  }

  /**
   * One page of per-person totals for the export, in a stable order (name, then id) so paging
   * by offset never repeats or skips anyone.
   */
  async summaryPage(periodId: string, offset: number, limit: number) {
    return this.context.tx
      .select({
        employeeId: timesheetLines.employeeId,
        name: employees.name,
        email: employees.email,
        rateMinor: sql<number>`max(${timesheetLines.rateMinor})::int`,
        currency: sql<string>`max(${timesheetLines.currency})`,
        regularMinutes: sql<number>`coalesce(sum(${timesheetLines.minutes}) filter (where ${timesheetLines.category} = 'regular'), 0)::int`,
        overtimeMinutes: sql<number>`coalesce(sum(${timesheetLines.minutes}) filter (where ${timesheetLines.category} = 'overtime'), 0)::int`,
        nightMinutes: sql<number>`coalesce(sum(${timesheetLines.minutes}) filter (where ${timesheetLines.night}), 0)::int`,
        amountMinor: sql<number>`sum(${timesheetLines.amountMinor})::int`,
      })
      .from(timesheetLines)
      .innerJoin(
        employees,
        and(eq(employees.orgId, timesheetLines.orgId), eq(employees.id, timesheetLines.employeeId)),
      )
      .where(
        and(eq(timesheetLines.orgId, this.context.orgId), eq(timesheetLines.payPeriodId, periodId)),
      )
      .groupBy(timesheetLines.employeeId, employees.name, employees.email)
      .orderBy(asc(employees.name), asc(timesheetLines.employeeId))
      .offset(offset)
      .limit(limit);
  }

  /** One page of lines for the export, ordered by person, day, kind and id (stable). */
  async linesPage(periodId: string, offset: number, limit: number) {
    return this.context.tx
      .select({ line: timesheetLines, name: employees.name })
      .from(timesheetLines)
      .innerJoin(
        employees,
        and(eq(employees.orgId, timesheetLines.orgId), eq(employees.id, timesheetLines.employeeId)),
      )
      .where(
        and(eq(timesheetLines.orgId, this.context.orgId), eq(timesheetLines.payPeriodId, periodId)),
      )
      .orderBy(
        asc(employees.name),
        asc(timesheetLines.employeeId),
        asc(timesheetLines.date),
        asc(timesheetLines.category),
        asc(timesheetLines.id),
      )
      .offset(offset)
      .limit(limit);
  }
}
