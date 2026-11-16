import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { AppConfig } from '../../../config/app-config.js';
import { parseEnv } from '../../../config/env.js';
import { configureApp } from '../../../configure-app.js';

let database: TestDatabase;
let app: NestFastifyApplication;
let ipCounter = 0;

interface Cookie {
  name: string;
  value: string;
  path?: string;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  maxAge?: number;
}

beforeAll(async () => {
  database = await startTestDatabase();
  const config = new AppConfig(
    parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: database.urlFor('app_user'),
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters',
    }),
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(config)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await database?.stop();
});

/**
 * A fake browser with its own IP (so rate limits don't leak between tests), or a given one to
 * model several people behind the same office connection.
 */
function client(ip?: string) {
  ipCounter += 1;
  const remoteAddress = ip ?? `10.0.0.${ipCounter}`;

  async function request(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: unknown; cookie?: string; token?: string; rawBody?: string } = {},
  ) {
    const headers: Record<string, string> = {};
    if (options.cookie) headers.cookie = `shiftora_rt=${options.cookie}`;
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.rawBody !== undefined) headers['content-type'] = 'application/json';
    const res = await app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      remoteAddress,
      ...(options.body !== undefined ? { payload: options.body as object } : {}),
      ...(options.rawBody !== undefined ? { payload: options.rawBody } : {}),
    });
    const refreshCookie = (res.cookies as Cookie[]).find((c) => c.name === 'shiftora_rt');
    return { res, refreshCookie, json: () => res.json<Record<string, unknown>>() };
  }

  return {
    get: (path: string, options?: { token?: string }) => request('GET', path, options),
    post: (path: string, options?: { body?: unknown; cookie?: string; rawBody?: string }) =>
      request('POST', path, options),
  };
}

let emailCounter = 0;
function newEmail(): string {
  emailCounter += 1;
  return `person${emailCounter}@example.com`;
}

async function signedUp(browser = client()) {
  const email = newEmail();
  const { res, refreshCookie } = await browser.post('/auth/signup', {
    body: { name: 'Asha Patel', email, password: 'correct horse' },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ accessToken: string }>();
  return { browser, email, token: body.accessToken, cookie: refreshCookie!.value };
}

describe('POST /auth/signup', () => {
  it('creates the user, returns an access token and sets a locked-down refresh cookie', async () => {
    const browser = client();
    const { res, refreshCookie } = await browser.post('/auth/signup', {
      body: { name: '  Asha Patel ', email: ' Asha@Example.org ', password: 'correct horse' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      accessToken: expect.any(String) as string,
      expiresIn: 900,
      user: { name: 'Asha Patel', email: 'Asha@Example.org', emailVerified: false },
    });
    expect(res.body).not.toMatch(/password/i);

    expect(refreshCookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/api/v1/auth',
      maxAge: 30 * 24 * 60 * 60,
    });
    expect(refreshCookie?.secure).toBeFalsy(); // only in production
    expect(refreshCookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('rejects the same email in different casing with 409', async () => {
    const { email } = await signedUp();
    const { res } = await client().post('/auth/signup', {
      body: { name: 'Copy', email: email.toUpperCase(), password: 'another password' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'auth.email_taken', status: 409 });
  });

  it('returns 400 problem+json listing every invalid field', async () => {
    const { res } = await client().post('/auth/signup', {
      body: { name: '', email: 'nope', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json<{ code: string; errors: { path: string }[] }>();
    expect(body.code).toBe('validation_failed');
    expect(body.errors.map((e) => e.path).sort()).toEqual(['email', 'name', 'password']);
  });

  it('returns 400 problem+json for a malformed JSON body', async () => {
    const { res } = await client().post('/auth/signup', { rawBody: '{"name": ' });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'validation_failed' });
  });
});

describe('GET /auth/me', () => {
  it('returns the caller with a valid access token', async () => {
    const { browser, token, email } = await signedUp();
    const { res } = await browser.get('/auth/me', { token });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email, name: 'Asha Patel' });
  });

  it.each([
    ['no token', undefined],
    ['a garbage token', 'not-a-jwt'],
  ])('returns 401 problem+json with %s', async (_label, token) => {
    const { res } = await client().get('/auth/me', token ? { token } : {});

    expect(res.statusCode).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({ code: 'auth.unauthenticated' });
  });
});

describe('POST /auth/login', () => {
  it('logs in with the right password, any email casing', async () => {
    const { email } = await signedUp();
    const { res, refreshCookie } = await client().post('/auth/login', {
      body: { email: email.toUpperCase(), password: 'correct horse' },
    });

    expect(res.statusCode).toBe(200);
    expect(refreshCookie?.value).toBeTruthy();
  });

  it('gives identical answers for a wrong password and an unknown email', async () => {
    const { email } = await signedUp();
    const wrongPassword = await client().post('/auth/login', {
      body: { email, password: 'wrong password' },
    });
    const unknownEmail = await client().post('/auth/login', {
      body: { email: 'nobody@example.com', password: 'wrong password' },
    });

    expect(wrongPassword.res.statusCode).toBe(401);
    expect(unknownEmail.res.statusCode).toBe(401);
    expect(wrongPassword.res.body).toBe(unknownEmail.res.body);
    expect(wrongPassword.json()).toMatchObject({ code: 'auth.invalid_credentials' });
  });

  it('rate-limits the 11th attempt in a minute from one IP with 429', async () => {
    const browser = client();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const { res } = await browser.post('/auth/login', {
        body: { email: 'nobody@example.com', password: 'guess' },
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const { browser, cookie } = await signedUp();
    const { res, refreshCookie } = await browser.post('/auth/refresh', { cookie });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accessToken: expect.any(String) as string, expiresIn: 900 });
    expect(refreshCookie?.value).toBeTruthy();
    expect(refreshCookie?.value).not.toBe(cookie);
  });

  it('treats reuse of an old token as theft: 401, cookie cleared, whole login revoked', async () => {
    const { browser, cookie: original } = await signedUp();
    const rotated = (await browser.post('/auth/refresh', { cookie: original })).refreshCookie!
      .value;

    const replay = await browser.post('/auth/refresh', { cookie: original });
    expect(replay.res.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ code: 'auth.invalid_refresh_token' });
    expect(replay.refreshCookie?.value).toBe(''); // cleared

    // The legitimate, newer token from the same login is now dead too.
    const afterTheft = await browser.post('/auth/refresh', { cookie: rotated });
    expect(afterTheft.res.statusCode).toBe(401);
  });

  it('lets exactly one of 5 simultaneous refreshes with the same token succeed', async () => {
    const { browser, cookie } = await signedUp();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => browser.post('/auth/refresh', { cookie })),
    );

    const statuses = results.map((r) => r.res.statusCode).sort();
    expect(statuses).toEqual([200, 401, 401, 401, 401]);
  });

  it('returns 401 without a cookie or with an unknown one', async () => {
    expect((await client().post('/auth/refresh')).res.statusCode).toBe(401);
    expect((await client().post('/auth/refresh', { cookie: 'x'.repeat(43) })).res.statusCode).toBe(
      401,
    );
  });
});

describe('POST /auth/logout', () => {
  it('revokes the session and clears the cookie', async () => {
    const { browser, cookie } = await signedUp();
    const logout = await browser.post('/auth/logout', { cookie });

    expect(logout.res.statusCode).toBe(204);
    expect(logout.refreshCookie?.value).toBe('');
    expect((await browser.post('/auth/refresh', { cookie })).res.statusCode).toBe(401);
  });

  it('is idempotent: 204 without a cookie too', async () => {
    expect((await client().post('/auth/logout')).res.statusCode).toBe(204);
  });
});

describe('default protection', () => {
  it('keeps the health checks public', async () => {
    expect((await client().get('/health/live')).res.statusCode).toBe(200);
    expect((await client().get('/health/ready')).res.statusCode).toBe(200);
  });

  it('returns problem+json 404 for unknown routes', async () => {
    const { res } = await client().get('/nope');

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });
});

describe('refresh rate limit: per login, not per IP', () => {
  it('a whole office behind one IP can refresh at once', async () => {
    // Twelve people, each signed up from home (signup stays limited per IP)...
    const people = await Promise.all(Array.from({ length: 12 }, () => signedUp()));
    // ...then all reload the app at work, behind the clinic's single public IP.
    const office = '203.0.113.7';
    const statuses: number[] = [];
    for (const person of people) {
      const { res } = await client(office).post('/auth/refresh', { cookie: person.cookie });
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual(Array(12).fill(200));
  });

  it('one login is still limited, even when every request comes from a new IP', async () => {
    let { cookie } = await signedUp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const { res, refreshCookie } = await client().post('/auth/refresh', { cookie });
      statuses.push(res.statusCode);
      if (refreshCookie?.value) cookie = refreshCookie.value; // follow the rotation
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });

  it('requests without a known session are limited per IP, junk cookies included', async () => {
    const browser = client();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      // A fresh random "token" each time must not buy a fresh budget.
      const { res } = await browser.post('/auth/refresh', { cookie: `junk-${i}` });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });
});
