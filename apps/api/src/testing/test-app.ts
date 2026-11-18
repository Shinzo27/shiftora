import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Logger } from 'pino';
import {
  createDatabaseConnection,
  setTenantContext,
  type DatabaseConnection,
  type Transaction,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';

import { AppModule } from '../app.module.js';
import { AppConfig } from '../config/app-config.js';
import { parseEnv } from '../config/env.js';
import { createLogger, PinoNestLogger } from '../common/logging.js';
import { configureApp, fastifyOptions } from '../configure-app.js';

/**
 * The whole API (every module, guard, interceptor and filter) on a throwaway Postgres.
 * Requests go through Fastify's in-process `inject`, so no port is opened.
 */
export interface TestApp {
  app: NestFastifyApplication;
  /** The throwaway Postgres, so a second app can share it (`startTestApp({ database })`). */
  database: TestDatabase;
  /** Direct database access as app_user, for checking what a request wrote. */
  queryAs<T>(
    context: { userId: string; orgId: string },
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Extra environment, e.g. a webhook secret or a REDIS_URL. */
  env?: Record<string, string>;
  /** Share a database with another test app (two API instances), instead of starting one. */
  database?: TestDatabase;
  /** Where the app logs; tests that read log lines pass a capturing logger. Silent otherwise. */
  logger?: Logger;
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const ownsDatabase = !options.database;
  const database: TestDatabase = options.database ?? (await startTestDatabase());
  const config = new AppConfig(
    parseEnv({
      NODE_ENV: 'test',
      DATABASE_URL: database.urlFor('app_user'),
      JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters',
      ...options.env,
    }),
  );
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AppConfig)
    .useValue(config)
    .compile();
  const logger = options.logger ?? createLogger({ level: 'silent' });
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(fastifyOptions(logger)),
    { rawBody: true, logger: new PinoNestLogger(logger) },
  );
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const direct: DatabaseConnection = createDatabaseConnection(database.urlFor('app_user'));

  return {
    app,
    database,
    queryAs: (context, fn) =>
      direct.db.transaction(async (tx) => {
        await setTenantContext(tx, context);
        return fn(tx);
      }),
    close: async () => {
      await direct.close();
      await app.close();
      if (ownsDatabase) await database.stop();
    },
  };
}

export interface ApiResponse {
  status: number;
  body: unknown;
  json<T = Record<string, unknown>>(): T;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

let clientCounter = 0;

/** A logged-in user making requests from their own IP (so rate limits don't collide). */
export class TestUser {
  private readonly remoteAddress: string;

  constructor(
    private readonly app: NestFastifyApplication,
    readonly id: string,
    readonly email: string,
    readonly token: string,
  ) {
    clientCounter += 1;
    this.remoteAddress = `10.${Math.floor(clientCounter / 250)}.${clientCounter % 250}.1`;
  }

  /** Calls /api/v1{path}. Pass `org` to act in an organisation (sets X-Org-Id). */
  async call(
    method: Method,
    path: string,
    options: { body?: object; org?: string; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (options.org) headers['x-org-id'] = options.org;
    Object.assign(headers, options.headers ?? {});
    const res = await this.app.inject({
      method,
      url: `/api/v1${path}`,
      headers,
      remoteAddress: this.remoteAddress,
      ...(options.body ? { payload: options.body } : {}),
    });
    const body: unknown = res.body ? JSON.parse(res.body) : undefined;
    return {
      status: res.statusCode,
      body,
      json: <T>() => body as T,
    };
  }
}

/** Creates an org owned by `owner` and returns its id. */
export async function createOrg(owner: TestUser, name = 'Sunrise Clinic'): Promise<string> {
  const res = await owner.call('POST', '/orgs', { body: { name } });
  if (res.status !== 201) throw new Error(`create org failed: ${res.status}`);
  return res.json<{ id: string }>().id;
}

/** Signs up a new user and brings them into `org` with `role` through a real invite. */
export async function addMember(
  app: NestFastifyApplication,
  owner: TestUser,
  org: string,
  role: 'owner' | 'manager' | 'employee',
): Promise<TestUser> {
  const user = await signUp(app, `New ${role}`);
  const invite = await owner.call('POST', '/invites', { org, body: { email: user.email, role } });
  if (invite.status !== 201) throw new Error(`invite failed: ${invite.status}`);
  const code = invite.json<{ code: string }>().code;
  const accepted = await user.call('POST', '/invites/accept', { body: { code } });
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status}`);
  return user;
}

let emailCounter = 0;

/** Signs up a fresh user and returns them logged in. */
export async function signUp(app: NestFastifyApplication, name = 'Test User'): Promise<TestUser> {
  emailCounter += 1;
  const email = `user${emailCounter}-${Date.now()}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: { name, email, password: 'correct horse' },
    remoteAddress: `172.16.${Math.floor(emailCounter / 250)}.${emailCounter % 250}`,
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  const body = res.json<{ accessToken: string; user: { id: string } }>();
  return new TestUser(app, body.user.id, email, body.accessToken);
}
