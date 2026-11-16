import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dispatchDelivery } from './dispatch.js';
import {
  sendPushToEmployee,
  type PushOutcome,
  type PushSender,
  type StoredSubscription,
} from './push.js';

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;
let ashaId: string;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const asOrg = async <T>(run: (tx: Tx) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    return run(tx);
  });

/** A sender that answers what the test tells it, and records who it was asked to reach. */
function fakePush(outcomes: PushOutcome[] = ['sent']): PushSender & { seen: StoredSubscription[] } {
  const seen: StoredSubscription[] = [];
  return {
    seen,
    send(subscription) {
      seen.push(subscription);
      return Promise.resolve(outcomes.shift() ?? 'sent');
    },
  };
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;

  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'push@test.local', 'Owner', 'x') returning id`,
  );
  userId = owner.rows[0]!.id;
  orgId = crypto.randomUUID();

  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: orgId, name: 'Sunrise Clinic' });
    await tx
      .insert(schema.locations)
      .values({
        orgId,
        name: 'Andheri',
        latitude: 19.1197,
        longitude: 72.8468,
        radiusM: 120,
        timezone: 'Asia/Kolkata',
      })
      .returning();

    const [asha] = await tx
      .insert(schema.employees)
      .values({
        orgId,
        name: 'Asha Mehta',
        email: 'asha@sunriseclinic.test',
        notifyChannel: 'push',
        hourlyRateMinor: 45_000,
      })
      .returning();
    ashaId = asha!.id;
  });
});

// Each test starts with no devices, so "two devices" means exactly two.
beforeEach(async () => {
  await asOrg((tx) => tx.delete(schema.pushSubscriptions));
});

afterAll(async () => {
  await database?.stop();
});

/** A notification for Asha on one channel, with its delivery row. */
async function queueDelivery(
  channel: 'push' | 'email',
  options: { employeeId?: string | null } = {},
): Promise<{ deliveryId: string; notificationId: string }> {
  return asOrg(async (tx) => {
    const [event] = await tx
      .insert(schema.outbox)
      .values({ orgId, topic: 'schedule.published', payload: {} })
      .returning();

    const [notification] = await tx
      .insert(schema.notifications)
      .values({
        orgId,
        outboxId: event!.id,
        employeeId: options.employeeId === undefined ? ashaId : options.employeeId,
        kind: 'schedule.published',
        subject: 'Your week is published',
        body: '3 shifts, Monday 9 November to Sunday 15 November.',
        payload: { url: '/shifts' },
      })
      .returning();

    const [delivery] = await tx
      .insert(schema.deliveries)
      .values({ orgId, notificationId: notification!.id, channel, status: 'queued' })
      .returning();

    return { deliveryId: delivery!.id, notificationId: notification!.id };
  });
}

const subscribe = (endpoint: string) =>
  asOrg(async (tx) => {
    await tx.insert(schema.pushSubscriptions).values({
      orgId,
      employeeId: ashaId,
      endpoint,
      p256dh: 'p256dh-key-material-for-the-test',
      auth: 'auth-secret',
    });
  });

describe('sending a push', () => {
  it('reaches every subscribed device and marks the delivery sent', async () => {
    await subscribe('https://fcm.googleapis.com/fcm/send/device-one');
    await subscribe('https://fcm.googleapis.com/fcm/send/device-two');
    const { deliveryId } = await queueDelivery('push');

    const sender = fakePush(['sent', 'sent']);
    const outcome = await dispatchDelivery(
      db,
      { mailer: null as never, push: sender, whatsapp: null, sms: null },
      { deliveryId, orgId },
    );

    expect(outcome).toEqual({ status: 'sent' });
    expect(sender.seen).toHaveLength(2);

    const [row] = await asOrg((tx) =>
      tx
        .select()
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    expect(row?.status).toBe('sent');
    expect(row?.attempts).toBe(1);
    expect(row?.sentAt).not.toBeNull();
  });

  it('forgets a subscription the push service says is gone, and still counts the send', async () => {
    await subscribe('https://fcm.googleapis.com/fcm/send/dead-device');
    await subscribe('https://fcm.googleapis.com/fcm/send/live-device');
    const { deliveryId } = await queueDelivery('push');

    const outcome = await dispatchDelivery(
      db,
      { mailer: null as never, push: fakePush(['gone', 'sent']), whatsapp: null, sms: null },
      { deliveryId, orgId },
    );
    expect(outcome).toEqual({ status: 'sent' });

    const rows = await asOrg((tx) => tx.select().from(schema.pushSubscriptions));
    const endpoints = rows.map((row) => row.endpoint);
    expect(endpoints).not.toContain('https://fcm.googleapis.com/fcm/send/dead-device');
  });

  it('skips — and does not retry — when no device has notifications on', async () => {
    // A fresh employee with no subscriptions at all.
    const noDevices = await asOrg(async (tx) => {
      const [employee] = await tx
        .insert(schema.employees)
        .values({
          orgId,
          name: 'Rohan Desai',
          email: 'rohan@sunriseclinic.test',
          notifyChannel: 'push',
          hourlyRateMinor: 40_000,
        })
        .returning();
      return employee!.id;
    });

    const { deliveryId } = await queueDelivery('push', { employeeId: noDevices });
    const outcome = await dispatchDelivery(
      db,
      { mailer: null as never, push: fakePush(), whatsapp: null, sms: null },
      { deliveryId, orgId },
    );

    expect(outcome).toEqual({ status: 'skipped', reason: 'No device has notifications on' });
    const [row] = await asOrg((tx) =>
      tx
        .select()
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    expect(row?.status).toBe('skipped');
  });

  it('records a failure, and asks for a retry, when the device refuses', async () => {
    await subscribe('https://fcm.googleapis.com/fcm/send/grumpy');
    const { deliveryId } = await queueDelivery('push');

    const outcome = await dispatchDelivery(
      db,
      { mailer: null as never, push: fakePush(['failed']), whatsapp: null, sms: null },
      { deliveryId, orgId },
    );
    expect(outcome.status).toBe('retry');

    const [row] = await asOrg((tx) =>
      tx
        .select()
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toContain('refused');
  });

  it('records a skip, not a retry, when Web Push is not configured', async () => {
    const { deliveryId } = await queueDelivery('push');
    const outcome = await dispatchDelivery(
      db,
      { mailer: null as never, push: null, whatsapp: null, sms: null },
      { deliveryId, orgId },
    );

    // No VAPID keys is permanent: a retry cannot add them, so the job completes and the row says
    // why. (The fan-out no longer offers push in this state either — this covers rows queued
    // while push was configured and the keys were removed afterwards.)
    // Since W4 D4 a skip like this also moves down the ladder (`fallbackDeliveryId`).
    expect(outcome).toMatchObject({ status: 'skipped', reason: 'Web Push is not configured' });
    const [row] = await asOrg((tx) =>
      tx
        .select()
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    expect(row?.status).toBe('skipped');
    expect(row?.lastError).toBe('Web Push is not configured');
  });
});

describe('sendPushToEmployee', () => {
  it('sends nothing, and says nothing, for someone with no subscriptions', async () => {
    const result = await sendPushToEmployee(db, orgId, crypto.randomUUID(), fakePush(), {
      title: 'Hello',
      body: 'Nobody is listening',
    });
    expect(result).toEqual({ sent: 0, gone: 0, failed: 0 });
  });

  it('stays inside the organisation', async () => {
    // A subscription in another org must never be read, even for the same endpoint shape.
    await asOrg(async (tx) => {
      await tx.insert(schema.pushSubscriptions).values({
        orgId,
        employeeId: ashaId,
        endpoint: `https://fcm.googleapis.com/fcm/send/${crypto.randomUUID()}`,
        p256dh: 'p256dh-key-material-for-the-test',
        auth: 'auth-secret',
      });
    });

    const sender = fakePush();
    const result = await sendPushToEmployee(db, orgId, ashaId, sender, {
      title: 'Hello',
      body: 'Only this org',
    });

    expect(result.sent).toBe(sender.seen.length);
    expect(result.sent).toBeGreaterThan(0);
  });
});
