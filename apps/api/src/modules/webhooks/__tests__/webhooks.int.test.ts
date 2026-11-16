import { createHmac } from 'node:crypto';

import { and, eq, isNull, schema, sql } from '@shiftora/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestApp, type TestApp } from '../../../testing/test-app.js';

/**
 * W4 D5: the WhatsApp webhook. Public, but only a body signed with the app secret is believed;
 * a verified report becomes one `delivery.reported` platform event for the worker, and nothing
 * about the recipient (their number) is kept.
 */

const SECRET = 'meta-app-secret-for-tests';
const VERIFY = 'verify-token-for-tests';

let t: TestApp;
let unconfigured: TestApp;

beforeAll(async () => {
  t = await startTestApp({
    env: { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: VERIFY },
  });
  // A second API instance on the same database, with no webhook configured.
  unconfigured = await startTestApp({ database: t.database });
});

afterAll(async () => {
  await unconfigured?.close();
  await t?.close();
});

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

function webhook(statuses: unknown[]): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses } }],
      },
    ],
  });
}

const status = (id: string, kind: string, extra: object = {}) => ({
  id,
  status: kind,
  timestamp: '1794799860', // 2026-11-16T03:31:00Z
  recipient_id: '919820000001',
  ...extra,
});

function post(app: TestApp, body: string, signature?: string) {
  return app.app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/whatsapp',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-hub-signature-256': signature } : {}),
    },
    payload: body,
  });
}

/** Platform events are visible only to the relay, so read them with its switch on. */
async function reportedEvents(): Promise<unknown[]> {
  const rows = await t.queryAs(
    { userId: crypto.randomUUID(), orgId: crypto.randomUUID() },
    async (tx) => {
      await tx.execute(sql`select set_config('app.outbox_relay', 'on', true)`);
      return tx
        .select({ payload: schema.outbox.payload })
        .from(schema.outbox)
        .where(and(eq(schema.outbox.topic, 'delivery.reported'), isNull(schema.outbox.orgId)))
        .orderBy(schema.outbox.createdAt);
    },
  );
  return rows.map((row) => row.payload);
}

describe('GET /webhooks/whatsapp (Meta’s registration handshake)', () => {
  it('echoes the challenge for the right verify token', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('1158201444');
  });

  it('refuses a wrong token (403)', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /webhooks/whatsapp', () => {
  it('turns a signed status webhook into one delivery.reported event, without the number', async () => {
    const before = (await reportedEvents()).length;
    const body = webhook([
      status('wamid.A', 'delivered'),
      status('wamid.B', 'failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }),
      status('wamid.C', 'deleted'), // a kind we do not track: skipped, not refused
    ]);

    const res = await post(t, body, sign(body));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: 2 });
    const events = await reportedEvents();
    expect(events).toHaveLength(before + 1);
    expect(events.at(-1)).toEqual({
      channel: 'whatsapp',
      reports: [
        { messageId: 'wamid.A', status: 'delivered', at: '2026-11-16T03:31:00.000Z' },
        {
          messageId: 'wamid.B',
          status: 'failed',
          at: '2026-11-16T03:31:00.000Z',
          error: 'Message undeliverable (131026)',
        },
      ],
    });
    expect(JSON.stringify(events.at(-1))).not.toContain('9820000001');
  });

  it('refuses a body whose signature does not match (401), and records nothing', async () => {
    const before = (await reportedEvents()).length;
    const body = webhook([status('wamid.X', 'read')]);

    const forged = await post(t, body, sign(body, 'not-the-app-secret'));
    const unsigned = await post(t, body);
    // Signed, then altered in transit: the signature covers the exact bytes.
    const tampered = await post(t, body.replace('"read"', '"failed"'), sign(body));

    for (const res of [forged, unsigned, tampered]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: 'webhook.bad_signature' });
    }
    expect(await reportedEvents()).toHaveLength(before);
  });

  it('answers 200 and records nothing for a webhook with no statuses (an incoming message)', async () => {
    const before = (await reportedEvents()).length;
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'w', changes: [{ field: 'messages', value: { messages: [{ id: 'in-1' }] } }] }],
    });

    const res = await post(t, body, sign(body));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: 0 });
    expect(await reportedEvents()).toHaveLength(before);
  });

  it('is off (404) on an API with no app secret', async () => {
    const body = webhook([status('wamid.Y', 'delivered')]);
    const res = await post(unconfigured, body, sign(body));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'webhook.not_configured' });
  });
});
