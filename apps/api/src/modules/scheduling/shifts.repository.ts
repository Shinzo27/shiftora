import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, lt, ne, schema, sql } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { shifts } = schema;

export type ShiftRecord = typeof shifts.$inferSelect;
export type ShiftValues = Omit<
  typeof shifts.$inferInsert,
  'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'version'
>;

/**
 * Shift rows, always inside the request's transaction and always filtered by org explicitly
 * (RLS is the safety net behind that filter, see AGENTS.md).
 */
@Injectable()
export class ShiftsRepository {
  constructor(private readonly context: RequestContext) {}

  /** A week's shifts in time order, for the board. */
  async listBySchedule(scheduleId: string): Promise<ShiftRecord[]> {
    return this.context.tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.scheduleId, scheduleId)))
      .orderBy(asc(shifts.startsAt), asc(shifts.id));
  }

  async findById(id: string): Promise<ShiftRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.id, id)))
      .limit(1);
    return row ?? null;
  }

  async create(values: ShiftValues): Promise<ShiftRecord> {
    const [row] = await this.context.tx
      .insert(shifts)
      .values({ ...values, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  /**
   * Applies a change only if the row is still at `expectedVersion`, then bumps the version.
   * Null means someone else saved first (the caller answers 409).
   */
  async update(
    id: string,
    expectedVersion: number,
    values: Partial<ShiftValues>,
  ): Promise<ShiftRecord | null> {
    const [row] = await this.context.tx
      .update(shifts)
      .set({ ...values, version: sql`${shifts.version} + 1` })
      .where(
        and(
          eq(shifts.orgId, this.context.orgId),
          eq(shifts.id, id),
          eq(shifts.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.id, id)));
  }

  /**
   * The employee's live shifts overlapping a window, at ANY location in the org: overlap,
   * weekly hours and rest are always counted per person, never per branch (PRD F1).
   */
  async forEmployee(employeeId: string, from: Date, to: Date): Promise<ShiftRecord[]> {
    return this.context.tx
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, this.context.orgId),
          eq(shifts.employeeId, employeeId),
          ne(shifts.status, 'cancelled'),
          lt(shifts.startsAt, to),
          gt(shifts.endsAt, from),
        ),
      )
      .orderBy(asc(shifts.startsAt));
  }
}
