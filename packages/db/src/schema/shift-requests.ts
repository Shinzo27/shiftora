import { shiftRequestStatuses, shiftRequestTypes } from '@shiftora/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps, timestamptz } from './columns.js';
import { employees } from './employees.js';
import { shifts } from './shifts.js';

export const shiftRequestType = pgEnum('shift_request_type', shiftRequestTypes);
export const shiftRequestStatus = pgEnum('shift_request_status', shiftRequestStatuses);

/**
 * A swap, drop or pickup, and where it has got to (state machine in
 * `packages/domain/requests/shift-request.ts`). Tenant table (RLS).
 *
 * The database keeps the shape honest: a swap names a colleague and a drop does not; a
 * colleague is never the requester; a shift has at most one request waiting at a time (as the
 * shift given, or the shift taken in return), so two requests cannot fight over one shift.
 * Every foreign key includes `org_id`, as everywhere else.
 */
export const shiftRequests = pgTable(
  'shift_requests',
  {
    id: id(),
    orgId: uuid().notNull(),
    type: shiftRequestType().notNull(),
    status: shiftRequestStatus().notNull(),
    /** The shift being given away (swap, drop) or taken (pickup). */
    shiftId: uuid().notNull(),
    requesterEmployeeId: uuid().notNull(),
    /** Swap only: who takes the shift. */
    targetEmployeeId: uuid(),
    /** Swap only, optional: the colleague's shift the requester takes in return. */
    targetShiftId: uuid(),
    /** The requester's reason, for the manager. */
    note: text(),
    /** When the colleague accepted or declined (swap). */
    respondedAt: timestamptz(),
    /** When it was approved, rejected, cancelled or expired; by whom when a manager decided. */
    decidedAt: timestamptz(),
    decidedBy: uuid(),
    decisionNote: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'shift_requests_shift_fk',
      columns: [t.orgId, t.shiftId],
      foreignColumns: [shifts.orgId, shifts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'shift_requests_target_shift_fk',
      columns: [t.orgId, t.targetShiftId],
      foreignColumns: [shifts.orgId, shifts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'shift_requests_requester_fk',
      columns: [t.orgId, t.requesterEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'shift_requests_target_employee_fk',
      columns: [t.orgId, t.targetEmployeeId],
      foreignColumns: [employees.orgId, employees.id],
    }).onDelete('restrict'),
    uniqueIndex('shift_requests_one_open_per_shift')
      .on(t.shiftId)
      .where(sql`status in ('pending_colleague', 'pending_manager')`),
    uniqueIndex('shift_requests_one_open_per_target_shift')
      .on(t.targetShiftId)
      .where(
        sql`status in ('pending_colleague', 'pending_manager') and target_shift_id is not null`,
      ),
    index('shift_requests_org_status_idx').on(t.orgId, t.status, t.createdAt),
    index('shift_requests_requester_idx').on(t.orgId, t.requesterEmployeeId),
    index('shift_requests_target_idx').on(t.orgId, t.targetEmployeeId),
    check(
      'shift_requests_swap_has_colleague',
      sql`(${t.type} = 'swap') = (${t.targetEmployeeId} is not null)`,
    ),
    check(
      'shift_requests_target_shift_is_swap',
      sql`${t.targetShiftId} is null or ${t.type} = 'swap'`,
    ),
    check(
      'shift_requests_not_self',
      sql`${t.targetEmployeeId} is null or ${t.targetEmployeeId} <> ${t.requesterEmployeeId}`,
    ),
    check(
      'shift_requests_two_shifts',
      sql`${t.targetShiftId} is null or ${t.targetShiftId} <> ${t.shiftId}`,
    ),
    // A decision by a person has a time; an expiry has a time and no person.
    check(
      'shift_requests_decider_has_time',
      sql`${t.decidedBy} is null or ${t.decidedAt} is not null`,
    ),
    // Open means undecided, decided means closed.
    check(
      'shift_requests_open_undecided',
      sql`(${t.status} in ('pending_colleague', 'pending_manager')) = (${t.decidedAt} is null)`,
    ),
  ],
);

export type ShiftRequestRow = typeof shiftRequests.$inferSelect;
