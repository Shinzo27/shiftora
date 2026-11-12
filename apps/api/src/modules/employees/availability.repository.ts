import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt, schema } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { availability, timeOff } = schema;
export type AvailabilityRecord = typeof availability.$inferSelect;
export type TimeOffRecord = typeof timeOff.$inferSelect;

/** Weekly availability and time off of employees in the current org. */
@Injectable()
export class AvailabilityRepository {
  constructor(private readonly context: RequestContext) {}

  async slots(employeeId: string): Promise<AvailabilityRecord[]> {
    return this.context.tx
      .select()
      .from(availability)
      .where(
        and(eq(availability.orgId, this.context.orgId), eq(availability.employeeId, employeeId)),
      )
      .orderBy(asc(availability.weekday), asc(availability.startLocal));
  }

  /** Availability of several employees in one query (a week board's rows). */
  async slotsForEmployees(employeeIds: string[]): Promise<AvailabilityRecord[]> {
    if (employeeIds.length === 0) return [];
    return this.context.tx
      .select()
      .from(availability)
      .where(
        and(
          eq(availability.orgId, this.context.orgId),
          inArray(availability.employeeId, employeeIds),
        ),
      )
      .orderBy(
        asc(availability.employeeId),
        asc(availability.weekday),
        asc(availability.startLocal),
      );
  }

  async replaceSlots(
    employeeId: string,
    slots: { weekday: number; start: string; end: string }[],
  ): Promise<void> {
    const orgId = this.context.orgId;
    await this.context.tx
      .delete(availability)
      .where(and(eq(availability.orgId, orgId), eq(availability.employeeId, employeeId)));
    if (slots.length > 0) {
      await this.context.tx.insert(availability).values(
        slots.map((slot) => ({
          orgId,
          employeeId,
          weekday: slot.weekday,
          startLocal: slot.start,
          endLocal: slot.end,
        })),
      );
    }
  }

  /** Time off that overlaps [from, to), either bound optional. */
  async timeOff(employeeId: string, from?: Date, to?: Date): Promise<TimeOffRecord[]> {
    const conditions = [eq(timeOff.orgId, this.context.orgId), eq(timeOff.employeeId, employeeId)];
    if (from) conditions.push(gt(timeOff.endsAt, from));
    if (to) conditions.push(lt(timeOff.startsAt, to));
    return this.context.tx
      .select()
      .from(timeOff)
      .where(and(...conditions))
      .orderBy(asc(timeOff.startsAt));
  }

  /** Time off of several employees that overlaps [from, to), in one query. */
  async timeOffForEmployees(employeeIds: string[], from: Date, to: Date): Promise<TimeOffRecord[]> {
    if (employeeIds.length === 0) return [];
    return this.context.tx
      .select()
      .from(timeOff)
      .where(
        and(
          eq(timeOff.orgId, this.context.orgId),
          inArray(timeOff.employeeId, employeeIds),
          gt(timeOff.endsAt, from),
          lt(timeOff.startsAt, to),
        ),
      )
      .orderBy(asc(timeOff.employeeId), asc(timeOff.startsAt));
  }

  async findTimeOff(id: string): Promise<TimeOffRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(timeOff)
      .where(and(eq(timeOff.orgId, this.context.orgId), eq(timeOff.id, id)))
      .limit(1);
    return row ?? null;
  }

  async createTimeOff(values: {
    employeeId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string | null;
  }): Promise<TimeOffRecord> {
    const [row] = await this.context.tx
      .insert(timeOff)
      .values({ ...values, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  async removeTimeOff(id: string): Promise<void> {
    await this.context.tx
      .delete(timeOff)
      .where(and(eq(timeOff.orgId, this.context.orgId), eq(timeOff.id, id)));
  }
}
