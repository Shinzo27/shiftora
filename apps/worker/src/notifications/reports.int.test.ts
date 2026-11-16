import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { ALL_CHANNELS, usageMonth } from '@shiftora/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Mailer } from '../mailer.js';
import { dispatchDelivery } from './dispatch.js';
import { FakeMessageSender } from './fake-sender.js';
import { fanOutSchedulePublished } from './fan-out.js';
import type { Queue } from 'bullmq';

import { handleNotificationJob } from '../handlers.js';
import type { DeliveryJobData } from '../queues.js';
import { applyDeliveryReports } from './reports.js';

/**
 * W4 D5: a provider's delivery reports (webhooks) applied to the delivery they name — forward
 * only, idempotent, a late failure falls back to email and gives the quota back, and a report
 * can only ever touch the delivery that carries its message id.
 */

let database: TestDatabase;
let db: Database;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

interface Clinic {
  orgId: string;
  userId: string;
  ashaId: string;
  locationId: string;
}

let clinic: Clinic;
let other: Clinic;

const asOrg = async <T>(c: Clinic, run: (tx: Tx) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId: c.userId, orgId: c.orgId });
    return run(tx);
  });

async function createClinic(name: string): Promise<Clinic> {
  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, ${`${crypto.randomUUID()}@test.local`}, 'Owner', 'x') returning id`,
  );
  const c = {
    orgId: crypto.randomUUID(),
    userId: owner.rows[0]!.id,
    ashaId: '',
    locationId: '',
  };
  await asOrg(c, async (tx) => {
    await tx.insert(schema.organizations).values({ id: c.orgId, name });
    const [location] = await tx
      .insert(schema.locations)
      .values({
        orgId: c.orgId,
        name: 'Andheri',
        latitude: 19.1197,
        longitude: 72.8468,
        radiusM: 120,
        timezone: 'Asia/Kolkata',
      })
      .returning();
    c.locationId = location!.id;
    const [asha] = await tx
      .insert(schema.employees)
      .values({
        orgId: c.orgId,
        name: 'Asha Mehta',
        email: 'asha@sunriseclinic.test',
        phone: '+919820000001',
        notifyChannel: 'whatsapp',
        hourlyRateMinor: 45_000,
      })
      .returning();
    c.ashaId = asha!.id;
  });
  return c;
}

const mailer: Mailer = {
  send: () => Promise.resolve({ messageId: 'mail' }),
  close: () => undefined,
};

async function queuedWhatsApp(c: Clinic): Promise<string> {
  const fanOut = await fanOutSchedulePublished(
    db,
    {
      id: crypto.randomUUID(),
      orgId: c.orgId,
      topic: 'schedule.published',
      payload: {
        locationId: c.locationId,
        weekStart: '2026-11-09',
        affectedEmployeeIds: [c.ashaId],
      },
    },
    ALL_CHANNELS,
  );
  return fanOut.deliveryIds[0]!;
}

/** A WhatsApp message to Asha, sent through the fake provider: its row id and message id. */
async function sentWhatsApp(c: Clinic): Promise<{ deliveryId: string; messageId: string }> {
  const deliveryId = await queuedWhatsApp(c);
  const whatsapp = new FakeMessageSender('whatsapp');
  const result = await dispatchDelivery(
    db,
    { mailer, push: null, whatsapp, sms: null },
    { deliveryId, orgId: c.orgId },
  );
  expect(result.status).toBe('sent');
  const row = await rowOf(c, deliveryId);
  expect(row.providerMessageId).toMatch(/^fake-whatsapp-/);
  return { deliveryId, messageId: row.providerMessageId! };
}

async function rowOf(c: Clinic, deliveryId: string) {
  const [row] = await asOrg(c, (tx) =>
    tx
      .select({
        channel: schema.deliveries.channel,
        address: schema.deliveries.address,
        status: schema.deliveries.status,
        providerMessageId: schema.deliveries.providerMessageId,
        deliveredAt: schema.deliveries.deliveredAt,
        readAt: schema.deliveries.readAt,
        lastError: schema.deliveries.lastError,
        notificationId: schema.deliveries.notificationId,
      })
      .from(schema.deliveries)
      .where(sql`id = ${deliveryId}`),
  );
  return row!;
}

async function usage(c: Clinic): Promise<number> {
  const [row] = await asOrg(c, (tx) =>
    tx
      .select({ count: schema.messageUsage.sentCount })
      .from(schema.messageUsage)
      .where(sql`org_id = ${c.orgId} and month = ${usageMonth(new Date())}`),
  );
  return row?.count ?? 0;
}

function report(
  messageId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  at = '2026-11-16T03:31:00.000Z',
  error?: string,
) {
  return {
    channel: 'whatsapp' as const,
    reports: [{ messageId, status, at, ...(error ? { error } : {}) }],
  };
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;
  clinic = await createClinic('Sunrise Clinic');
  other = await createClinic('Lotus Clinic');
});

afterAll(async () => {
  await database?.stop();
});

describe('applying delivery reports', () => {
  it('delivered, then read: the row moves forward and keeps both times', async () => {
    const { deliveryId, messageId } = await sentWhatsApp(clinic);

    const first = await applyDeliveryReports(
      db,
      report(messageId, 'delivered', '2026-11-16T03:31:00.000Z'),
      ALL_CHANNELS,
    );
    expect(first).toMatchObject({ applied: 1, ignored: 0, unknown: 0 });
    await applyDeliveryReports(
      db,
      report(messageId, 'read', '2026-11-16T03:35:00.000Z'),
      ALL_CHANNELS,
    );

    expect(await rowOf(clinic, deliveryId)).toMatchObject({
      status: 'delivered',
      deliveredAt: new Date('2026-11-16T03:31:00.000Z'),
      readAt: new Date('2026-11-16T03:35:00.000Z'),
    });
  });

  it('the same report twice applies once (providers resend)', async () => {
    const { messageId } = await sentWhatsApp(clinic);
    const first = await applyDeliveryReports(db, report(messageId, 'delivered'), ALL_CHANNELS);
    const again = await applyDeliveryReports(db, report(messageId, 'delivered'), ALL_CHANNELS);
    expect(first.applied).toBe(1);
    expect(again).toMatchObject({ applied: 0, ignored: 1 });
  });

  it('an id we never sent is counted as unknown and changes nothing', async () => {
    const outcome = await applyDeliveryReports(
      db,
      report('wamid.not-ours', 'delivered'),
      ALL_CHANNELS,
    );
    expect(outcome).toMatchObject({ applied: 0, unknown: 1 });
  });

  it('a late failure fails the row, gives the quota back, and falls back to email', async () => {
    const { deliveryId, messageId } = await sentWhatsApp(clinic);
    const before = await usage(clinic);

    const outcome = await applyDeliveryReports(
      db,
      report(messageId, 'failed', '2026-11-16T03:31:00.000Z', 'Message undeliverable'),
      ALL_CHANNELS,
    );

    expect(outcome.applied).toBe(1);
    expect(outcome.fallbacks).toEqual([
      { deliveryId: expect.any(String) as string, orgId: clinic.orgId },
    ]);
    const row = await rowOf(clinic, deliveryId);
    expect(row).toMatchObject({ status: 'failed', lastError: 'WhatsApp: Message undeliverable' });
    expect(await usage(clinic)).toBe(before - 1);

    expect(await rowOf(clinic, outcome.fallbacks[0]!.deliveryId)).toMatchObject({
      channel: 'email',
      address: 'asha@sunriseclinic.test',
      status: 'queued',
      notificationId: row.notificationId,
    });
  });

  it('a failure after "delivered" is ignored: it already reached the phone', async () => {
    const { deliveryId, messageId } = await sentWhatsApp(clinic);
    await applyDeliveryReports(db, report(messageId, 'delivered'), ALL_CHANNELS);
    const outcome = await applyDeliveryReports(db, report(messageId, 'failed'), ALL_CHANNELS);
    expect(outcome).toMatchObject({ applied: 0, ignored: 1, fallbacks: [] });
    expect((await rowOf(clinic, deliveryId)).status).toBe('delivered');
  });

  it('a report finds the right org by message id, and touches nothing in another org', async () => {
    const mine = await sentWhatsApp(clinic);
    const theirs = await sentWhatsApp(other);

    await applyDeliveryReports(db, report(theirs.messageId, 'read'), ALL_CHANNELS);

    expect((await rowOf(other, theirs.deliveryId)).status).toBe('delivered');
    expect((await rowOf(clinic, mine.deliveryId)).status).toBe('sent');
  });

  it('the lookup switch ends with its transaction: a later query sees no other tenant', async () => {
    const theirs = await sentWhatsApp(other);
    await applyDeliveryReports(db, report(theirs.messageId, 'delivered'), ALL_CHANNELS);

    // Same pool, no org context, no switch: RLS returns nothing.
    const leaked = await db.transaction((tx) =>
      tx
        .select({ id: schema.deliveries.id })
        .from(schema.deliveries)
        .where(sql`provider_message_id = ${theirs.messageId}`),
    );
    expect(leaked).toEqual([]);
  });

  it('a report that beats the worker\'s own "sent" write is not undone by it', async () => {
    const deliveryId = await queuedWhatsApp(clinic);
    // A provider so fast its "delivered" is applied while the send call is still returning.
    const whatsapp = {
      send: async () => {
        await asOrg(clinic, (tx) =>
          tx.execute(
            sql`update deliveries set status = 'delivered', delivered_at = now() where id = ${deliveryId}`,
          ),
        );
        return { messageId: `fast-${crypto.randomUUID()}` };
      },
    };
    await dispatchDelivery(
      db,
      { mailer, push: null, whatsapp, sms: null },
      { deliveryId, orgId: clinic.orgId },
    );
    expect((await rowOf(clinic, deliveryId)).status).toBe('delivered');
  });
});

describe('the delivery.reported job', () => {
  it('a report that beats the recorded message id fails the job (retried), then applies', async () => {
    const deliveryId = await queuedWhatsApp(clinic);
    const messageId = `early-${crypto.randomUUID()}`;
    const deps = {
      deliveries: { add: () => Promise.resolve() } as unknown as Queue<DeliveryJobData>,
      appUrl: 'http://app.test',
      mailer,
      usable: ALL_CHANNELS,
    };
    const job = {
      outboxId: crypto.randomUUID(),
      orgId: null as unknown as string, // a platform event
      topic: 'delivery.reported',
      payload: report(messageId, 'delivered'),
    };

    // The provider's report is here; our write of its message id is not, yet.
    await expect(handleNotificationJob(db, deps, job)).rejects.toThrow(/not recorded yet/);

    await asOrg(clinic, (tx) =>
      tx.execute(
        sql`update deliveries set status = 'sent', provider_message_id = ${messageId} where id = ${deliveryId}`,
      ),
    );
    // BullMQ's retry: the same job, now that the id exists.
    await handleNotificationJob(db, deps, job);
    expect((await rowOf(clinic, deliveryId)).status).toBe('delivered');
  });
});
