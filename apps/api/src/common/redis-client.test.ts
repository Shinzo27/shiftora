import { describe, expect, it, vi } from 'vitest';

import { closeRedisClient, type ClosableRedisClient } from './redis-client.js';

/** A client in one of the three states that matter at shutdown, recording what was called. */
function client(state: 'ready' | 'reconnecting' | 'closed') {
  const calls = { close: 0, destroy: 0 };
  const stub: ClosableRedisClient = {
    isReady: state === 'ready',
    isOpen: state !== 'closed',
    close: () => {
      calls.close += 1;
      return Promise.resolve();
    },
    destroy: () => {
      calls.destroy += 1;
    },
  };
  return { stub, calls };
}

describe('closeRedisClient', () => {
  it('closes a connected client gracefully, so in-flight commands finish', async () => {
    const { stub, calls } = client('ready');
    await closeRedisClient(stub);
    expect(calls).toEqual({ close: 1, destroy: 0 });
  });

  it('destroys a client that is reconnecting instead of waiting for it', async () => {
    // The bug this exists for: `quit()` on this client never settles, so `app.close()` hung for
    // ever and the API could not stop — reproduced with `REDIS_URL=redis://127.0.0.1:1`.
    const { stub, calls } = client('reconnecting');
    await closeRedisClient(stub);
    expect(calls).toEqual({ close: 0, destroy: 1 });
  });

  it('leaves an already closed client alone', async () => {
    const { stub, calls } = client('closed');
    await closeRedisClient(stub);
    expect(calls).toEqual({ close: 0, destroy: 0 });
  });

  it('does nothing at all for a client that was never created (no REDIS_URL)', async () => {
    await expect(closeRedisClient(null)).resolves.toBeUndefined();
  });

  it('never calls quit(), which is the call that hangs while reconnecting', async () => {
    const quit = vi.fn(() => Promise.resolve());
    const { stub } = client('reconnecting');
    await closeRedisClient(Object.assign(stub, { quit }));
    expect(quit).not.toHaveBeenCalled();
  });
});
