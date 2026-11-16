import { and, eq, schema, sql } from '@shiftora/db';
import { usageMonth } from '@shiftora/domain';
import type { DeadLetter, MessageUsage } from '@shiftora/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  addMember,
  createOrg,
  signUp,
  startTestApp,
  type TestApp,
} from '../../../testing/test-app.js';

let t: TestApp;

beforeAll(async () => {
  t = await startTestApp();
});

afterAll(async () => {
  await t?.close();
});

const andheri = { name: 'Andheri', latitude: 19.11, longitude: 72.84, timezone: 'Asia/Kolkata' };

/**
 * A clinic with one location and Asha (prefers WhatsApp), whose WhatsApp message was
 * dead-lettered after five attempts and fell back to an email that was sent.
 */
async function clinicWithDeadLetter() {
  const owner = await signUp(t.app, 'Owner');
  const org = await createOrg(owner);
  const location = await owner.call('POST', '/locations', { org, body: andheri });
  expect(location.status).toBe(201);
  const employee = await owner.call('POST', '/employees', {
    org,
    body: {
      name: 'Asha Mehta',
      email: 'asha@example.com',
      phone: '+919820000001',
      notifyChannel: 'whatsapp',
      locationIds: [location.json<{ id: string }>().id],
    },
  });
  expect(employee.status).toBe(201);
  const employeeId = employee.json<{ id: string }>().id;

  const ids = await t.queryAs({ userId: owner.id, orgId: org }, async (tx) => {
    const [notification] = await tx
      .insert(schema.notifications)
      .values({
        orgId: org,
        outboxId: crypto.randomUUID(),
        employeeId,
        kind: 'schedule.published',
        subject: 'Your shifts for the week of 9 Nov',
        body: 'Mon 09:00–17:00',
        payload: {},
      })
      .returning();
    const [dead] = await tx
      .insert(schema.deliveries)
      .values({
        orgId: org,
        notificationId: notification!.id,
        channel: 'whatsapp',
        address: '+919820000001',
        status: 'failed',
        attempts: 5,
        lastError: 'Fake whatsapp: provider unavailable (503)',
        deadLetteredAt: new Date(),
      })
      .returning();
    await tx.insert(schema.deliveries).values({
      orgId: org,
      notificationId: notification!.id,
      channel: 'email',
      address: 'asha@example.com',
      status: 'sent',
      attempts: 1,
      sentAt: new Date(),
    });
    return { deadId: dead!.id };
  });
  return { owner, org, ...ids };
}

describe('GET /messages/dead-letters', () => {
  it('lists what failed every retry, who it was for, and where it went instead', async () => {
    const { owner, org, deadId } = await clinicWithDeadLetter();

    const res = await owner.call('GET', '/messages/dead-letters', { org });

    expect(res.status).toBe(200);
    expect(res.json<DeadLetter[]>()).toEqual([
      expect.objectContaining({
        id: deadId,
        channel: 'whatsapp',
        recipient: 'Asha Mehta',
        address: '…001', // never the full number
        reason: 'Fake whatsapp: provider unavailable (503)',
        attempts: 5,
        replays: 0,
        fallback: { channel: 'email', status: 'sent' },
      }),
    ]);
  });

  it('is owner-only (managers and employees get 403)', async () => {
    const { owner, org } = await clinicWithDeadLetter();
    for (const role of ['manager', 'employee'] as const) {
      const member = await addMember(t.app, owner, org, role);
      const res = await member.call('GET', '/messages/dead-letters', { org });
      expect(res.status, role).toBe(403);
    }
  });
});

describe('POST /messages/dead-letters/:id/replay', () => {
  it('puts it back in line through the outbox, with an audit row', async () => {
    const { owner, org, deadId } = await clinicWithDeadLetter();

    const res = await owner.call('POST', `/messages/dead-letters/${deadId}/replay`, { org });

    expect(res.status).toBe(200);
    expect(res.json()).toEqual({ id: deadId, status: 'queued', replays: 1 });

    const state = await t.queryAs({ userId: owner.id, orgId: org }, async (tx) => {
      const [row] = await tx
        .select({
          status: schema.deliveries.status,
          deadLetteredAt: schema.deliveries.deadLetteredAt,
          replays: schema.deliveries.replays,
        })
        .from(schema.deliveries)
        .where(eq(schema.deliveries.id, deadId));
      const events = await tx
        .select({ payload: schema.outbox.payload })
        .from(schema.outbox)
        .where(and(eq(schema.outbox.orgId, org), eq(schema.outbox.topic, 'delivery.replay')));
      const audit = await tx
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(and(eq(schema.auditEvents.orgId, org), eq(schema.auditEvents.entityId, deadId)));
      return { row, events, audit };
    });
    expect(state.row).toEqual({ status: 'queued', deadLetteredAt: null, replays: 1 });
    expect(state.events.map((e) => e.payload)).toEqual([{ deliveryId: deadId, replays: 1 }]);
    expect(state.audit.map((a) => a.action)).toEqual(['delivery.replayed']);
  });

  it('a message that is not dead-lettered cannot be replayed (409), so nothing is sent twice', async () => {
    const { owner, org, deadId } = await clinicWithDeadLetter();
    await owner.call('POST', `/messages/dead-letters/${deadId}/replay`, { org });

    const again = await owner.call('POST', `/messages/dead-letters/${deadId}/replay`, { org });

    expect(again.status).toBe(409);
    expect(again.json()).toMatchObject({ code: 'delivery.not_dead_lettered' });
  });

  it('an unknown id is a 404', async () => {
    const { owner, org } = await clinicWithDeadLetter();
    const res = await owner.call('POST', `/messages/dead-letters/${crypto.randomUUID()}/replay`, {
      org,
    });
    expect(res.status).toBe(404);
    expect(res.json()).toMatchObject({ code: 'delivery.not_found' });
  });

  it("another org's dead letters are invisible and cannot be replayed", async () => {
    const a = await clinicWithDeadLetter();
    const b = await clinicWithDeadLetter();

    const list = await b.owner.call('GET', '/messages/dead-letters', { org: b.org });
    expect(list.json<DeadLetter[]>().map((d) => d.id)).toEqual([b.deadId]);
    const replay = await b.owner.call('POST', `/messages/dead-letters/${a.deadId}/replay`, {
      org: b.org,
    });
    expect(replay.status).toBe(404);
  });
});

describe('GET /messages/usage', () => {
  it("shows this month's paid messages against the quota (per active location)", async () => {
    const { owner, org } = await clinicWithDeadLetter();
    const month = usageMonth(new Date());
    await t.queryAs({ userId: owner.id, orgId: org }, (tx) =>
      tx.execute(sql`
        insert into message_usage (org_id, month, channel, sent_count)
        values (${org}, ${month}, 'whatsapp', 42)`),
    );

    const res = await owner.call('GET', '/messages/usage', { org });

    expect(res.status).toBe(200);
    expect(res.json<MessageUsage>()).toEqual({
      month,
      channels: [
        { channel: 'whatsapp', used: 42, limit: 1_000 },
        { channel: 'sms', used: 0, limit: 200 },
      ],
    });
  });
});
