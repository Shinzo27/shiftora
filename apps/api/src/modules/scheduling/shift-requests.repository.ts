import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, schema } from '@shiftora/db';
import { OPEN_REQUEST_STATUSES, type ShiftRequestStatus } from '@shiftora/domain';

import { RequestContext } from '../../database/request-context.js';

const { shiftRequests, shifts } = schema;

export type ShiftRequestRecord = typeof shiftRequests.$inferSelect;

export interface NewRequestValues {
  type: 'swap' | 'drop' | 'pickup';
  status: ShiftRequestStatus;
  shiftId: string;
  requesterEmployeeId: string;
  targetEmployeeId: string | null;
  targetShiftId: string | null;
  note: string | null;
}

/** How a request changes when someone acts on it. */
export interface RequestChange {
  status: ShiftRequestStatus;
  respondedAt?: Date;
  decidedAt?: Date;
  decidedBy?: string | null;
  decisionNote?: string | null;
}

/** How many requests a list returns: an inbox, not an archive. */
const LIST_LIMIT = 100;

@Injectable()
export class ShiftRequestsRepository {
  constructor(private readonly context: RequestContext) {}

  async create(values: NewRequestValues): Promise<ShiftRequestRecord> {
    const [row] = await this.context.tx
      .insert(shiftRequests)
      .values({ ...values, orgId: this.context.orgId })
      .returning();
    return row!;
  }

  async findById(id: string): Promise<ShiftRequestRecord | null> {
    const [row] = await this.context.tx
      .select()
      .from(shiftRequests)
      .where(and(eq(shiftRequests.orgId, this.context.orgId), eq(shiftRequests.id, id)));
    return row ?? null;
  }

  /**
   * Moves a request on **only if it is still in the state the caller saw**: two people acting at
   * once (the colleague declining while a manager rejects) produce one decision, and the loser
   * gets null (→ 409) instead of overwriting it.
   */
  async change(
    id: string,
    from: ShiftRequestStatus,
    change: RequestChange,
  ): Promise<ShiftRequestRecord | null> {
    const [row] = await this.context.tx
      .update(shiftRequests)
      .set(change)
      .where(
        and(
          eq(shiftRequests.orgId, this.context.orgId),
          eq(shiftRequests.id, id),
          eq(shiftRequests.status, from),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** The requests a person is part of, as requester or as the named colleague. */
  async forEmployee(employeeId: string): Promise<ShiftRequestRecord[]> {
    return this.context.tx
      .select()
      .from(shiftRequests)
      .where(
        and(
          eq(shiftRequests.orgId, this.context.orgId),
          or(
            eq(shiftRequests.requesterEmployeeId, employeeId),
            eq(shiftRequests.targetEmployeeId, employeeId),
          ),
        ),
      )
      .orderBy(desc(shiftRequests.createdAt))
      .limit(LIST_LIMIT);
  }

  /**
   * The manager's inbox: requests whose shift is at one of these locations (`null` = every
   * location, for owners and unrestricted managers). Open ones only, unless `all`.
   */
  async forLocations(
    locationIds: string[] | null,
    scope: 'open' | 'all',
  ): Promise<ShiftRequestRecord[]> {
    if (locationIds && locationIds.length === 0) return [];
    const rows = await this.context.tx
      .select({ request: shiftRequests })
      .from(shiftRequests)
      .innerJoin(
        shifts,
        and(eq(shifts.orgId, shiftRequests.orgId), eq(shifts.id, shiftRequests.shiftId)),
      )
      .where(
        and(
          eq(shiftRequests.orgId, this.context.orgId),
          locationIds ? inArray(shifts.locationId, locationIds) : undefined,
          scope === 'open' ? inArray(shiftRequests.status, [...OPEN_REQUEST_STATUSES]) : undefined,
        ),
      )
      .orderBy(desc(shiftRequests.createdAt))
      .limit(LIST_LIMIT);
    return rows.map((row) => row.request);
  }
}
