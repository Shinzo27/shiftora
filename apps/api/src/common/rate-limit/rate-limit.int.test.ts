import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from '../../testing/test-app.js';

/**
 * W4 D5: rate limits counted in Redis are one limit for every API instance. Without Redis each
 * instance counts on its own — two instances let an attacker try twice as many passwords.
 */

let redis: StartedTestContainer;
let first: TestApp;
const opened: TestApp[] = [];

async function app(env: Record<string, string> = {}): Promise<TestApp> {
  const started = await startTestApp({ env, ...(first ? { database: first.database } : {}) });
  opened.push(started);
  return started;
}

beforeAll(async () => {
  redis = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
  first = await app();
});

afterAll(async () => {
  // Shared-database apps first; the one that owns the database last.
  for (const started of opened.slice(1).reverse()) await started.close();
  await first?.close();
  await redis?.stop();
});

let ipCounter = 0;
/** A fresh address per test, so tests don't share a budget. */
const freshIp = () => `198.51.100.${++ipCounter}`;

function login(target: TestApp, ip: string) {
  return target.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'nobody@example.com', password: 'wrong password' },
    remoteAddress: ip,
  });
}

describe('login rate limit across API instances', () => {
  it('with Redis, two instances share one budget: the 11th attempt is refused on either', async () => {
    const url = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
    const a = await app({ REDIS_URL: url });
    const b = await app({ REDIS_URL: url });
    const ip = freshIp();

    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await login(i % 2 ? b : a, ip)).statusCode);
    const eleventh = await login(b, ip);
    const twelfth = await login(a, ip);

    expect(statuses).toEqual(Array(10).fill(401));
    expect(eleventh.statusCode).toBe(429);
    expect(twelfth.statusCode).toBe(429);
  });

  it('without Redis, each instance counts alone (why the shared store exists)', async () => {
    const a = first;
    const b = await app();
    const ip = freshIp();

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) statuses.push((await login(i % 2 ? b : a, ip)).statusCode);

    // Twelve attempts, six per instance: nobody is stopped.
    expect(statuses).toEqual(Array(12).fill(401));
  });

  it('with Redis down, logins still work and the limit still holds in this process', async () => {
    const down = await app({ REDIS_URL: 'redis://127.0.0.1:1' });
    const ip = freshIp();

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await login(down, ip)).statusCode);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });
});
