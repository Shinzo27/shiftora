import type { Server } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';

import { SCHEDULE_CHANGED } from './realtime.events.js';
import { RealtimeService } from './realtime.service.js';

function fakeServer() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { server: { to } as unknown as Server, to, emit };
}

const event = {
  orgId: '01a1ce46-0000-7000-8000-000000000001',
  scheduleId: '01a1ce46-0000-7000-8000-000000000002',
  locationId: '01a1ce46-0000-7000-8000-000000000003',
  weekStart: '2026-11-09',
  kind: 'shifts' as const,
};

describe('RealtimeService', () => {
  it('says nothing when there is no socket server (tests, CLI, worker)', () => {
    const realtime = new RealtimeService();
    expect(() => realtime.scheduleChanged(event)).not.toThrow();
  });

  it('sends the event to the organisation room', () => {
    const { server, to, emit } = fakeServer();
    const realtime = new RealtimeService();
    realtime.attach(server);

    realtime.scheduleChanged(event);

    expect(to).toHaveBeenCalledWith(`org:${event.orgId}`);
    expect(emit).toHaveBeenCalledWith(SCHEDULE_CHANGED, event);
  });

  it('a broken socket layer never fails the write that triggered it', () => {
    const realtime = new RealtimeService();
    realtime.attach({
      to: () => {
        throw new Error('socket closed');
      },
    } as unknown as Server);

    expect(() => realtime.scheduleChanged(event)).not.toThrow();
  });
});
