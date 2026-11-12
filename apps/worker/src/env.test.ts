import { describe, expect, it } from 'vitest';

import { parseWorkerEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://app_user:app_user@localhost:5433/shiftora',
  REDIS_URL: 'redis://localhost:6380',
};

describe('parseWorkerEnv', () => {
  it('applies the relay defaults', () => {
    expect(parseWorkerEnv(base)).toMatchObject({
      NODE_ENV: 'development',
      RELAY_INTERVAL_MS: 2_000,
      RELAY_BATCH: 50,
      WORKER_CONCURRENCY: 5,
    });
  });

  it('refuses to start without Redis, unlike the API', () => {
    // Without a queue a worker has nothing to do; failing here beats a process that idles.
    expect(() => parseWorkerEnv({ DATABASE_URL: base.DATABASE_URL })).toThrow(/REDIS_URL/);
  });

  it('reads numbers from strings, as environment variables arrive', () => {
    expect(parseWorkerEnv({ ...base, RELAY_BATCH: '7' }).RELAY_BATCH).toBe(7);
  });

  it('never prints a secret in the error', () => {
    try {
      parseWorkerEnv({ ...base, REDIS_URL: 'http://not-redis' });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('REDIS_URL');
      expect(message).not.toContain(base.DATABASE_URL);
    }
  });
});
