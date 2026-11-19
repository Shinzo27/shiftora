/**
 * The shape `closeRedisClient` needs. Structural on purpose: the gateway declares its own
 * `RedisConnection`, the throttler holds a `RedisClientType`, and a test can pass three fields.
 */
export interface ClosableRedisClient {
  readonly isReady: boolean;
  readonly isOpen: boolean;
  close(): Promise<unknown>;
  destroy(): void;
}

/**
 * Closes a Redis client during shutdown, whatever state it is in.
 *
 * `quit()` sounds like the right call and is the wrong one. On a client that is *reconnecting* —
 * an unreachable `REDIS_URL`, a Redis that restarted, a container that is not up yet —
 * node-redis's `quit()` waits for a connection that may never come, so `app.close()` never
 * returns and the process hangs in a shutdown that looks like a slow test. Measured on
 * node-redis 5 with `redis://127.0.0.1:1` as the URL: `isOpen` is true, `isReady` is false,
 * `close()` settles immediately, `destroy()` settles immediately, and `quit()` does not settle
 * at all.
 *
 * So the three states, explicitly:
 *
 * - **ready** — `close()`: graceful, in-flight commands finish.
 * - **open but not ready** — `destroy()`: this is shutdown, there is nothing worth draining, and
 *   it also stops the reconnect loop from keeping the process alive.
 * - **already closed** — nothing.
 *
 * `Promise.all(...map(closeRedisClient))` over several clients is the safe shape for a gateway
 * holding a publisher and a subscriber.
 */
export async function closeRedisClient(client: ClosableRedisClient | null): Promise<void> {
  if (!client) return;

  if (client.isReady) {
    await client.close().catch(() => undefined);
    return;
  }
  if (client.isOpen) client.destroy();
}
