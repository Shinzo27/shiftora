import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseWorkerEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgres://app_user:app_user@localhost:5433/shiftora',
  REDIS_URL: 'redis://localhost:6380',
};

/** The file a new machine copies; empty optional keys mean "off" and must parse. */
function shippedEnvExample(): Record<string, string> {
  const path = fileURLToPath(new URL('../../../.env.example', import.meta.url));
  const source: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) source[match[1]!] = match[2]!;
  }
  return source;
}

describe('parseWorkerEnv', () => {
  it('accepts the .env.example a new machine copies', () => {
    // An empty `WHATSAPP_APP_SECRET=` used to fail `.min(16)`, so the worker could not start on
    // the documented setup path even though the variable is optional.
    expect(() => parseWorkerEnv(shippedEnvExample())).not.toThrow();
  });

  it('reads empty provider settings as their defaults', () => {
    const env = parseWorkerEnv({
      ...base,
      WHATSAPP_PROVIDER: '',
      SMS_PROVIDER: '',
      FAKE_PROVIDER_FAILURE: '',
      WHATSAPP_APP_SECRET: '',
      FAKE_PROVIDER_REPORT_URL: '',
    });
    expect(env.WHATSAPP_PROVIDER).toBe('none');
    expect(env.SMS_PROVIDER).toBe('none');
    expect(env.FAKE_PROVIDER_FAILURE).toBe('none');
    expect(env.WHATSAPP_APP_SECRET).toBeUndefined();
    expect(env.FAKE_PROVIDER_REPORT_URL).toBeUndefined();
  });

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
