import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
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
import { configureApp } from '../configure-app.js';

/**
 * The whole API (every module, guard, interceptor and filter) on a throwaway Postgres.
 * Requests go through Fastify's in-process `inject`, so no port is opened.
 */
export interface TestApp {
  app: NestFastifyApplication;
  /** Direct database access as app_user, for checking what a request wrote. */
  queryAs<T>(
    context: { userId: string; orgId: string },
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}

export async function startTestApp(): Promise<TestApp> {
  const database: TestDatabase = await startTestDatabase();
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
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const direct: DatabaseConnection = createDatabaseConnection(database.urlFor('app_user'));

  return {
    app,
    queryAs: (context, fn) =>
      direct.db.transaction(async (tx) => {
        await setTenantContext(tx, context);
        return fn(tx);
      }),
    close: async () => {
      await direct.close();
      await app.close();
      await database.stop();
    },
  };
}

export interface ApiResponse {
  status: number;
  body: unknown;
  json<T = Record<string, unknown>>(): T;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

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
    options: { body?: object; org?: string } = {},
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.token}` };
    if (options.org) headers['x-org-id'] = options.org;
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
