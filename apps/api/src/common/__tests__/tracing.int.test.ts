import { and, eq, isNull, schema, sql } from '@shiftora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createOrg, signUp, startTestApp, type TestApp } from '../../testing/test-app.js';
import { createLogger } from '../logging.js';

/**
 * W7 D5: a request's trace id is answered in `x-trace-id`, written on every outbox row the
 * request creates (so the worker can continue it), and stamped on the request's log line.
 */

const lines: Record<string, unknown>[] = [];
let t: TestApp;

beforeAll(async () => {
  t = await startTestApp({
    logger: createLogger({
      level: 'info',
      destination: {
        write: (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>),
      },
    }),
  });
});

afterAll(async () => {
  await t?.close();
});

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';

describe('tracing a request', () => {
  it("continues the caller's trace into the outbox and the log", async () => {
    const owner = await signUp(t.app, 'Priya Nair');
    const org = await createOrg(owner);

    const res = await owner.call('POST', '/invites', {
      org,
      body: { email: `staff-${Date.now()}@example.com`, role: 'employee' },
      headers: { traceparent: `00-${TRACE}-00f067aa0ba902b7-01` },
    });
    expect(res.status).toBe(201);

    const rows = await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx
        .select({ topic: schema.outbox.topic, traceId: schema.outbox.traceId })
        .from(schema.outbox)
        .where(and(eq(schema.outbox.orgId, org), eq(schema.outbox.topic, 'invite.created'))),
    );
    expect(rows).toEqual([{ topic: 'invite.created', traceId: TRACE }]);

    const line = lines.find((l) => l['msg'] === 'request' && l['traceId'] === TRACE);
    expect(line).toMatchObject({
      service: 'api',
      orgId: org,
      method: 'POST',
      route: '/api/v1/invites',
      status: 201,
    });
  });

  it('starts a new trace when the caller sends none, and answers with it', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      payload: { name: 'Asha', email: `asha-${Date.now()}@example.com`, password: 'correct horse' },
    });
    expect(res.statusCode).toBe(201);
    const traceId = res.headers['x-trace-id'];
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);

    // The verification email is a platform event, written outside any tenant transaction — it
    // still carries the trace. Reading platform rows takes the relay's switch (ADR 017).
    const userId = res.json<{ user: { id: string } }>().user.id;
    const platform = await t.queryAs({ userId, orgId: '' }, async (tx) => {
      await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);
      return tx
        .select({ traceId: schema.outbox.traceId })
        .from(schema.outbox)
        .where(and(isNull(schema.outbox.orgId), eq(schema.outbox.topic, 'auth.verify_email')));
    });
    expect(platform.map((row) => row.traceId)).toContain(traceId);
  });

  it('never logs the password or the access token', async () => {
    const owner = await signUp(t.app, 'Rohan Desai');
    await owner.call('GET', '/orgs');
    const text = JSON.stringify(lines);
    expect(text).not.toContain('correct horse');
    expect(text).not.toContain(owner.token);
  });
});
