import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { DatabaseConnection } from '@shiftora/db';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApp } from '../configure-app.js';
import { DATABASE } from '../database/database.module.js';
import { HealthController } from './health.controller.js';

let app: NestFastifyApplication | undefined;

/** Boots just the health controller over real HTTP (Fastify inject), with a fake database. */
async function startApp(execute: () => Promise<unknown>): Promise<NestFastifyApplication> {
  const fakeDatabase = {
    db: { execute },
    close: () => Promise.resolve(),
  } as unknown as DatabaseConnection;
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [{ provide: DATABASE, useValue: fakeDatabase }],
  }).compile();

  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await configureApp(app, { webOrigin: 'http://localhost:5173' });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HealthController', () => {
  it('GET /api/v1/health/live → 200', async () => {
    const res = await (await startApp(() => Promise.resolve([]))).inject('/api/v1/health/live');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/health/ready → 200 when the database answers', async () => {
    const res = await (await startApp(() => Promise.resolve([]))).inject('/api/v1/health/ready');

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'up' } });
  });

  it('GET /api/v1/health/ready → 503 when the database is down', async () => {
    const down = () => Promise.reject(new Error('connect ECONNREFUSED'));
    const res = await (await startApp(down)).inject('/api/v1/health/ready');

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', checks: { database: 'down' } });
  });
});
