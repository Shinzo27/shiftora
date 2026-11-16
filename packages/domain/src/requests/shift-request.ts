/**
 * Shift requests — swap, drop, pickup — as a state machine.
 *
 * Pure: the API asks "may this person do this to a request in this state?" and stores the
 * answer; nothing here touches a database or a clock. The rules (owner's decision, W5):
 *
 * - **swap**: the requester names a colleague (and optionally one of the colleague's shifts to
 *   take in return). The colleague accepts or declines; an accepted swap **always** waits for a
 *   manager — two staff agreeing is not enough.
 * - **drop**: the requester asks to give a shift up; a manager decides. Approved, the shift
 *   becomes open for others to pick up.
 * - **pickup**: taking an open shift. First valid claim wins (W5 D4), so it has no waiting
 *   state: a pickup is recorded when the claim succeeds.
 *
 * Any open request can be withdrawn by the requester, rejected by a manager, or expire because
 * the shift started before anyone decided.
 */

export const shiftRequestTypes = ['swap', 'drop', 'pickup'] as const;
export type ShiftRequestType = (typeof shiftRequestTypes)[number];

export const shiftRequestStatuses = [
  'pending_colleague',
  'pending_manager',
  'approved',
  'rejected',
  'declined',
  'cancelled',
  'expired',
] as const;
export type ShiftRequestStatus = (typeof shiftRequestStatuses)[number];

/** Still waiting for someone: at most one of these per shift (a partial unique index). */
export const OPEN_REQUEST_STATUSES = [
  'pending_colleague',
  'pending_manager',
] as const satisfies readonly ShiftRequestStatus[];

export const shiftRequestActions = [
  'colleague_accept',
  'colleague_decline',
  'manager_approve',
  'manager_reject',
  'cancel',
  'expire',
] as const;
export type ShiftRequestAction = (typeof shiftRequestActions)[number];

/** Who is acting, relative to the request (worked out by the API from the caller). */
export type ShiftRequestActor = 'requester' | 'colleague' | 'manager' | 'system';

export type TransitionResult =
  | { ok: true; status: ShiftRequestStatus }
  | {
      ok: false;
      /**
       * `closed`: the request is already decided; `not_allowed`: this action does not apply in
       * this state; `wrong_actor`: it does, but not for this person.
       */
      reason: 'closed' | 'not_allowed' | 'wrong_actor';
    };

interface Move {
  to: ShiftRequestStatus;
  by: readonly ShiftRequestActor[];
}

/** Every legal move. Anything not listed is refused. */
const MOVES: Partial<Record<ShiftRequestStatus, Partial<Record<ShiftRequestAction, Move>>>> = {
  pending_colleague: {
    colleague_accept: { to: 'pending_manager', by: ['colleague'] },
    colleague_decline: { to: 'declined', by: ['colleague'] },
    // A manager may stop a swap early (the colleague is on leave, the shift is being cut).
    manager_reject: { to: 'rejected', by: ['manager'] },
    cancel: { to: 'cancelled', by: ['requester'] },
    expire: { to: 'expired', by: ['system'] },
  },
  pending_manager: {
    manager_approve: { to: 'approved', by: ['manager'] },
    manager_reject: { to: 'rejected', by: ['manager'] },
    cancel: { to: 'cancelled', by: ['requester'] },
    expire: { to: 'expired', by: ['system'] },
  },
};

/** Where a new request starts. A pickup is only ever recorded once its claim has won. */
export function initialStatus(type: ShiftRequestType): ShiftRequestStatus {
  switch (type) {
    case 'swap':
      return 'pending_colleague';
    case 'drop':
      return 'pending_manager';
    case 'pickup':
      return 'approved';
  }
}

export function isOpenRequest(status: ShiftRequestStatus): boolean {
  return (OPEN_REQUEST_STATUSES as readonly ShiftRequestStatus[]).includes(status);
}

/** The status after `action` by `actor`, or why it is refused. */
export function transition(
  status: ShiftRequestStatus,
  action: ShiftRequestAction,
  actor: ShiftRequestActor,
): TransitionResult {
  const moves = MOVES[status];
  if (!moves) return { ok: false, reason: 'closed' };
  const move = moves[action];
  if (!move) return { ok: false, reason: 'not_allowed' };
  if (!move.by.includes(actor)) return { ok: false, reason: 'wrong_actor' };
  return { ok: true, status: move.to };
}

/** What this person may do now: drives the buttons a screen shows. */
export function availableActions(
  status: ShiftRequestStatus,
  actor: ShiftRequestActor,
): ShiftRequestAction[] {
  return shiftRequestActions.filter(
    (action) => action !== 'expire' && transition(status, action, actor).ok,
  );
}
