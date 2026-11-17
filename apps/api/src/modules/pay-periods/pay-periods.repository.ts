import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, schema } from '@shiftora/db';

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
}
