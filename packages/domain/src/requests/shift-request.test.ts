import { describe, expect, it } from 'vitest';

import {
  availableActions,
  initialStatus,
  isOpenRequest,
  shiftRequestActions,
  shiftRequestStatuses,
  transition,
  type ShiftRequestActor,
} from './shift-request.js';

const actors: ShiftRequestActor[] = ['requester', 'colleague', 'manager', 'system'];

describe('where a request starts', () => {
  it('a swap waits for the colleague, a drop for a manager, a pickup is already decided', () => {
    expect(initialStatus('swap')).toBe('pending_colleague');
    expect(initialStatus('drop')).toBe('pending_manager');
    expect(initialStatus('pickup')).toBe('approved');
  });
});

describe('a swap', () => {
  it('goes colleague → manager → approved', () => {
    const accepted = transition('pending_colleague', 'colleague_accept', 'colleague');
    expect(accepted).toEqual({ ok: true, status: 'pending_manager' });
    expect(transition('pending_manager', 'manager_approve', 'manager')).toEqual({
      ok: true,
      status: 'approved',
    });
  });

  it('is never approved on the colleague’s word alone: a manager must decide', () => {
    expect(transition('pending_colleague', 'manager_approve', 'manager')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
    expect(transition('pending_manager', 'manager_approve', 'colleague')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });
    expect(transition('pending_manager', 'manager_approve', 'requester')).toEqual({
      ok: false,
      reason: 'wrong_actor',
    });
  });

  it('only the named colleague can accept or decline, and only before it reaches a manager', () => {
    expect(transition('pending_colleague', 'colleague_accept', 'requester').ok).toBe(false);
    expect(transition('pending_colleague', 'colleague_decline', 'colleague')).toEqual({
      ok: true,
      status: 'declined',
    });
    expect(transition('pending_manager', 'colleague_decline', 'colleague')).toEqual({
      ok: false,
      reason: 'not_allowed',
    });
  });

  it('a manager may stop it before the colleague answers', () => {
    expect(transition('pending_colleague', 'manager_reject', 'manager')).toEqual({
      ok: true,
      status: 'rejected',
    });
  });
});

describe('any open request', () => {
  it.each(['pending_colleague', 'pending_manager'] as const)(
    'from %s can be withdrawn by the requester, or expire',
    (status) => {
      expect(transition(status, 'cancel', 'requester')).toEqual({ ok: true, status: 'cancelled' });
      expect(transition(status, 'cancel', 'colleague').ok).toBe(false);
      expect(transition(status, 'expire', 'system')).toEqual({ ok: true, status: 'expired' });
      expect(transition(status, 'expire', 'manager').ok).toBe(false);
    },
  );
});

describe('a decided request', () => {
  const terminal = shiftRequestStatuses.filter((status) => !isOpenRequest(status));

  it('refuses every action from everyone: decisions are final', () => {
    for (const status of terminal) {
      for (const action of shiftRequestActions) {
        for (const actor of actors) {
          expect(transition(status, action, actor), `${status} ${action} ${actor}`).toEqual({
            ok: false,
            reason: 'closed',
          });
        }
      }
    }
  });
});

describe('the whole table', () => {
  it('approval is reachable only from pending_manager, and only by a manager', () => {
    for (const status of shiftRequestStatuses) {
      for (const action of shiftRequestActions) {
        for (const actor of actors) {
          const result = transition(status, action, actor);
          if (result.ok && result.status === 'approved') {
            expect({ status, action, actor }).toEqual({
              status: 'pending_manager',
              action: 'manager_approve',
              actor: 'manager',
            });
          }
        }
      }
    }
  });

  it('a successful move always leaves the state it came from', () => {
    for (const status of shiftRequestStatuses) {
      for (const action of shiftRequestActions) {
        for (const actor of actors) {
          const result = transition(status, action, actor);
          if (result.ok) expect(result.status).not.toBe(status);
        }
      }
    }
  });
});

describe('availableActions', () => {
  it('shows each person only their own buttons', () => {
    expect(availableActions('pending_colleague', 'colleague')).toEqual([
      'colleague_accept',
      'colleague_decline',
    ]);
    expect(availableActions('pending_colleague', 'requester')).toEqual(['cancel']);
    expect(availableActions('pending_manager', 'manager')).toEqual([
      'manager_approve',
      'manager_reject',
    ]);
    expect(availableActions('approved', 'manager')).toEqual([]);
  });

  it('never offers "expire": that is the system’s, not a button', () => {
    for (const status of shiftRequestStatuses) {
      for (const actor of actors) expect(availableActions(status, actor)).not.toContain('expire');
    }
  });
});
