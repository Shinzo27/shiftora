import { io } from 'socket.io-client';

/** Mirrors the API's event: which week changed, and how. */
export interface ScheduleChangedEvent {
  orgId: string;
  scheduleId: string;
  locationId: string;
  weekStart: string;
  kind: 'shifts' | 'published';
}

/**
 * Listens for other people's edits to the week on screen.
 *
 * Same origin as the API (Vite proxies `/socket.io` in development), so the token is the only
 * credential the handshake carries — the socket joins the rooms the token's user belongs to and
 * nothing else. Reconnection is Socket.IO's own; each reconnection re-authenticates.
 *
 * Returns a teardown function: React calls it on unmount, which is what keeps one socket per
 * open board rather than one per render.
 */
export function connectRealtime(
  token: string,
  onScheduleChanged: (event: ScheduleChangedEvent) => void,
): () => void {
  const socket = io({
    path: '/socket.io',
    auth: { token },
    // Websocket first: the fallback to polling is only needed behind quirky proxies.
    transports: ['websocket', 'polling'],
  });
  socket.on('schedule.changed', onScheduleChanged);
  return () => socket.close();
}
