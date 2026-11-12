import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, schema, sql, type Transaction } from '@shiftora/db';

import { RequestContext } from '../../database/request-context.js';

const { timeEntries } = schema;
export type TimeEntryRow = typeof timeEntries.$inferSelect;

export interface ClockInValues {
  employeeId: string;
  locationId: string;
  shiftId: string | null;
  clockInAt: Date;
  deviceTime: Date;
  method: 'gps' | 'qr' | 'manual';
  inLatitude: number;
  inLongitude: number;
  inAccuracyM: number;
  /** Metres from the location, measured here rather than taken from the device. */
  inDistanceM: number;
  flags: string[];
  clientEventId: string;
}

export interface ClockOutValues {
  clockOutAt: Date;
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  distanceM?: number;
  flags: string[];
}

/** Attendance rows. Every query is org-scoped, even though RLS would catch a miss. */
@Injectable()
export class TimeEntriesRepository {
  constructor(private readonly context: RequestContext) {}

  private get tx(): Transaction {
    return this.context.tx;
  }

  /**
   * Serialises punches for one person for the rest of this transaction.
   *
   * The "one open punch" rule is a partial unique index, but a violation aborts the whole
   * transaction — so the losing request cannot read anything afterwards to explain itself
   * (Postgres answers 25P02 on every later statement). Taking a transaction-scoped advisory lock
   * first means the second caller waits, then *sees* the first punch and answers 409 without ever
   * provoking the constraint.
   */
  async lockEmployee(employeeId: string): Promise<void> {
    await this.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))`);
  }

  /** The employee's unfinished punch, if there is one (at most one: partial unique index). */
  async findOpen(employeeId: string): Promise<TimeEntryRow | null> {
    const [row] = await this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.context.orgId),
          eq(timeEntries.employeeId, employeeId),
          isNull(timeEntries.clockOutAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /**
   * The row a retried punch created. The unique index on `(org_id, client_event_id)` is what
   * makes this safe under two simultaneous retries: one insert wins, the other finds it here.
   */
  async findByClientEventId(clientEventId: string): Promise<TimeEntryRow | null> {
    const [row] = await this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.context.orgId),
          eq(timeEntries.clientEventId, clientEventId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findById(id: string): Promise<TimeEntryRow | null> {
    const [row] = await this.tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, this.context.orgId), eq(timeEntries.id, id)))
      .limit(1);
    return row ?? null;
  }

  async create(values: ClockInValues): Promise<TimeEntryRow> {
    const [row] = await this.tx
      .insert(timeEntries)
      .values({ ...values, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  /**
   * A manager's correction. Always marks the row `edited`: the audit row written beside this
   * holds what it was and why, so the flag is only ever a hint that history exists.
   */
  async update(
    id: string,
    values: { clockInAt: Date; clockOutAt: Date | null },
  ): Promise<TimeEntryRow | null> {
    const [row] = await this.tx
      .update(timeEntries)
      .set({ ...values, edited: true })
      .where(and(eq(timeEntries.orgId, this.context.orgId), eq(timeEntries.id, id)))
      .returning();
    return row ?? null;
  }

  /** Closes a punch. Conditional on it still being open, so two clock-outs cannot both win. */
  async close(id: string, values: ClockOutValues): Promise<TimeEntryRow | null> {
    const [row] = await this.tx
      .update(timeEntries)
      .set({
        clockOutAt: values.clockOutAt,
        outLatitude: values.latitude ?? null,
        outLongitude: values.longitude ?? null,
        outAccuracyM: values.accuracyM ?? null,
        outDistanceM: values.distanceM ?? null,
        flags: values.flags,
      })
      .where(
        and(
          eq(timeEntries.orgId, this.context.orgId),
          eq(timeEntries.id, id),
          isNull(timeEntries.clockOutAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** A person's punches whose clock-in falls in the window, newest first. */
  async forEmployee(employeeId: string, from: Date, to: Date): Promise<TimeEntryRow[]> {
    return this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.context.orgId),
          eq(timeEntries.employeeId, employeeId),
          gte(timeEntries.clockInAt, from),
          lte(timeEntries.clockInAt, to),
        ),
      )
      .orderBy(desc(timeEntries.clockInAt));
  }

  /** Everyone's punches at a location in a window: the manager's timesheet feed (week 5 edges). */
  async forLocation(locationId: string, from: Date, to: Date): Promise<TimeEntryRow[]> {
    return this.tx
      .select()
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.orgId, this.context.orgId),
          eq(timeEntries.locationId, locationId),
          gte(timeEntries.clockInAt, from),
          lte(timeEntries.clockInAt, to),
        ),
      )
      .orderBy(asc(timeEntries.clockInAt));
  }
}
