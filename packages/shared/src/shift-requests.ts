import { z } from 'zod';

/**
 * Swap and drop requests (W5 D2): what staff send, what managers decide, and what both see.
 * The rules live in `packages/domain/requests`; these are the shapes on the wire.
 */

export const shiftRequestType = z.enum(['swap', 'drop', 'pickup']);
export const shiftRequestStatus = z.enum([
  'pending_colleague',
  'pending_manager',
  'approved',
  'rejected',
  'declined',
  'cancelled',
  'expired',
]);
export type ShiftRequestStatusValue = z.output<typeof shiftRequestStatus>;

const reason = z.string().trim().max(500, 'At most 500 characters');

/**
 * A swap names the colleague who takes the shift, and optionally one of their shifts to take in
 * return; a drop names nobody. Pickups are claims of open shifts (W5 D4), not requests.
 */
export const newShiftRequest = z
  .object({
    type: z.enum(['swap', 'drop']),
    shiftId: z.uuid(),
    targetEmployeeId: z.uuid().optional(),
    targetShiftId: z.uuid().optional(),
    note: reason.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.type === 'swap' && !body.targetEmployeeId) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetEmployeeId'],
        message: 'Choose who takes the shift',
      });
    }
    if (body.type === 'drop' && (body.targetEmployeeId || body.targetShiftId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['targetEmployeeId'],
        message: 'A drop has no colleague: it goes to a manager',
      });
    }
    if (body.targetShiftId && body.targetShiftId === body.shiftId) {
      ctx.addIssue({ code: 'custom', path: ['targetShiftId'], message: 'Choose another shift' });
    }
  });
export type NewShiftRequest = z.output<typeof newShiftRequest>;

/** A manager's decision. `acknowledgeWarnings` is the "approve anyway" for advisories. */
export const decideShiftRequest = z.object({
  note: reason.optional(),
  acknowledgeWarnings: z.boolean().optional(),
});
export type DecideShiftRequest = z.output<typeof decideShiftRequest>;

export const listShiftRequestsQuery = z.object({
  /** `open` (default): waiting on someone; `all`: the last 100, decided included. */
  scope: z.enum(['open', 'all']).default('open'),
});
export type ListShiftRequestsQuery = z.output<typeof listShiftRequestsQuery>;

/** A shift as a request shows it: enough to recognise without opening the rota. */
export const requestShift = z.object({
  id: z.uuid(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  startsAt: z.iso.datetime(),
  locationId: z.uuid(),
  locationName: z.string(),
  jobRoleName: z.string().nullable(),
});
export type RequestShift = z.output<typeof requestShift>;

export const shiftRequestView = z.object({
  id: z.uuid(),
  type: shiftRequestType,
  status: shiftRequestStatus,
  shift: requestShift,
  /** The colleague's shift taken in return, for a swap that names one. */
  targetShift: requestShift.nullable(),
  requester: z.object({ id: z.uuid(), name: z.string() }),
  colleague: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  note: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  respondedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** What the caller may do now (buttons): `colleague_accept`, `manager_approve`, `cancel`… */
  actions: z.array(z.string()),
});
export type ShiftRequestView = z.output<typeof shiftRequestView>;
