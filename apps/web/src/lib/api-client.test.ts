import { describe, expect, it, vi } from 'vitest';

import { ApiClient, ApiError, type LockManagerLike } from './api-client.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake server: /auth/refresh hands out "token-N"; other routes need the latest token. */
function fakeServer({ refreshWorks = true } = {}) {
  let issued = 0;
  const refreshCalls = vi.fn();
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    await Promise.resolve();
    if (url.endsWith('/auth/refresh')) {
      refreshCalls();
      if (!refreshWorks) return json(401, { code: 'auth.invalid_refresh_token' });
      issued += 1;
      return json(200, { accessToken: `token-${issued}`, expiresIn: 900 });
    }
    const auth = new Headers(init.headers).get('authorization');
    if (auth !== `Bearer token-${issued}` || issued === 0) {
      return json(401, {
        code: 'auth.unauthenticated',
        detail: 'Missing or invalid access token.',
      });
    }
    return json(200, { ok: true, org: new Headers(init.headers).get('x-org-id') });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch, refreshCalls };
}

/** A minimal cross-tab lock: runs callbacks one at a time. */
function fakeLocks(): LockManagerLike {
  let queue = Promise.resolve();
  return {
    request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const result = queue.then(callback);
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

describe('ApiClient', () => {
  it('sends the access token and X-Org-Id', async () => {
    const server = fakeServer();
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch });
    await client.refresh();

    const body = await client.get<{ org: string }>('/org', { orgId: 'org-1' });

    expect(body.org).toBe('org-1');
    const [, init] = server.calls.mock.calls.at(-1)!;
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
    expect(init?.credentials).toBe('include');
  });

  it('refreshes once on a 401 and retries the request', async () => {
    const server = fakeServer();
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch });

    await expect(client.get('/org')).resolves.toMatchObject({ ok: true });
    expect(server.refreshCalls).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between concurrent 401s (single-flight)', async () => {
    const server = fakeServer();
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch, locks: fakeLocks() });

    await Promise.all([client.get('/a'), client.get('/b'), client.get('/c')]);

    expect(server.refreshCalls).toHaveBeenCalledTimes(1);
  });

  it('two tabs refresh one after the other, never at the same time', async () => {
    const server = fakeServer();
    const locks = fakeLocks();
    const tabA = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch, locks });
    const tabB = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch, locks });
    let running = 0;
    let maxConcurrent = 0;
    server.refreshCalls.mockImplementation(() => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      queueMicrotask(() => (running -= 1));
    });

    await Promise.all([tabA.refresh(), tabB.refresh()]);

    expect(server.refreshCalls).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);
  });

  it('throws an ApiError with the problem code when the session has ended', async () => {
    const server = fakeServer({ refreshWorks: false });
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch });

    const error = await client.get('/org').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'auth.unauthenticated' });
  });

  it('never refreshes on auth endpoints (a wrong password is a real 401)', async () => {
    const server = fakeServer();
    const client = new ApiClient({ baseUrl: '/api/v1', fetch: server.fetch });

    await expect(client.post('/auth/login', { body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(server.refreshCalls).not.toHaveBeenCalled();
  });

  it('decodes field errors from a 400', async () => {
    const fetch = vi.fn(async () => {
      await Promise.resolve();
      return json(400, {
        code: 'validation_failed',
        detail: 'The request is invalid.',
        errors: [{ path: 'email', message: 'Invalid email' }],
      });
    });
    const client = new ApiClient({ baseUrl: '', fetch });

    const error = await client.post('/auth/signup', { body: {} }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: 'validation_failed',
      fieldErrors: [{ path: 'email', message: 'Invalid email' }],
    });
  });
});
