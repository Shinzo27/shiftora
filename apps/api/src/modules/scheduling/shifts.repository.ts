import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, schema, sql } from '@shiftora/db';

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

  async findByIds(ids: string[]): Promise<ShiftRecord[]> {
    if (ids.length === 0) return [];
    return this.context.tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), inArray(shifts.id, ids)));
  }

  /**
   * Locks these shifts for the rest of the transaction, **in id order**: two approvals touching
   * the same pair of shifts lock them in the same order, so they queue instead of deadlocking.
   */
  async lockForUpdate(ids: string[]): Promise<ShiftRecord[]> {
    if (ids.length === 0) return [];
    return this.context.tx
      .select()
      .from(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), inArray(shifts.id, ids)))
      .orderBy(asc(shifts.id))
      .for('update');
  }

  /** Gives the shift to someone (assigned) or to nobody (open). Caller holds the row lock. */
  async reassign(id: string, employeeId: string | null): Promise<ShiftRecord> {
    const [row] = await this.context.tx
      .update(shifts)
      .set({
        employeeId,
        status: employeeId ? 'assigned' : 'open',
        version: sql`${shifts.version} + 1`,
      })
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.id, id)))
      .returning();
    return row!;
  }

  /**
   * Gives the shift to `employeeId` **only if it is still open at the version we read**. This is
   * the whole race: two claims both pass the eligibility check, both run this statement, and the
   * second updates zero rows because the first bumped the version. No lock, no queue — the
   * database is the arbiter.
   */
  async claim(
    id: string,
    employeeId: string,
    expectedVersion: number,
  ): Promise<ShiftRecord | null> {
    const [row] = await this.context.tx
      .update(shifts)
      .set({
        employeeId,
        status: 'assigned',
        version: sql`${shifts.version} + 1`,
        offeredAt: null,
      })
      .where(
        and(
          eq(shifts.orgId, this.context.orgId),
          eq(shifts.id, id),
          eq(shifts.status, 'open'),
          isNull(shifts.employeeId),
          eq(shifts.version, expectedVersion),
        ),
      )
      .returning();
    return row ?? null;
  }

  async markOffered(id: string, at: Date): Promise<void> {
    await this.context.tx
      .update(shifts)
      .set({ offeredAt: at })
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.id, id)));
  }

  /** Offered, still-open shifts at these locations that have not started (partial index 0019). */
  async offeredOpen(locationIds: string[], after: Date): Promise<ShiftRecord[]> {
    if (locationIds.length === 0) return [];
    return this.context.tx
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, this.context.orgId),
          inArray(shifts.locationId, locationIds),
          eq(shifts.status, 'open'),
          isNotNull(shifts.offeredAt),
          gt(shifts.startsAt, after),
        ),
      )
      .orderBy(asc(shifts.startsAt));
  }

  async remove(id: string): Promise<void> {
    await this.context.tx
      .delete(shifts)
      .where(and(eq(shifts.orgId, this.context.orgId), eq(shifts.id, id)));
  }

  /** Several employees' live shifts in a window, in one query (week-board conflicts). */
  async forEmployees(employeeIds: string[], from: Date, to: Date): Promise<ShiftRecord[]> {
    if (employeeIds.length === 0) return [];
    return this.context.tx
      .select()
      .from(shifts)
      .where(
        and(
          eq(shifts.orgId, this.context.orgId),
          inArray(shifts.employeeId, employeeIds),
          ne(shifts.status, 'cancelled'),
          lt(shifts.startsAt, to),
          gt(shifts.endsAt, from),
        ),
      )
      .orderBy(asc(shifts.employeeId), asc(shifts.startsAt));
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
