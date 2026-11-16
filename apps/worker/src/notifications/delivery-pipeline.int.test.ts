import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { ALL_CHANNELS, usageMonth } from '@shiftora/domain';
import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDeliveryWorker } from '../delivery-worker.js';
import { handleNotificationJob } from '../handlers.js';
import type { Mailer } from '../mailer.js';
import {
  connectionOptions,
  createRedis,
  deliveriesQueue,
  type DeliveryJobData,
} from '../queues.js';
import { dispatchDelivery, type Adapters } from './dispatch.js';
import { FakeMessageSender } from './fake-sender.js';
import { fanOutSchedulePublished } from './fan-out.js';
import { reserveMessage } from './quota.js';

/**
 * W4 D4: what happens when WhatsApp (here a fake provider) misbehaves — permanent refusals,
 * outages, rate limits, an exhausted quota — and, through a real BullMQ queue on a real Redis,
 * that a failing message is retried, dead-lettered, falls back to email, and can be replayed.
 */

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;
let ashaId: string;
let locationId: string;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const asOrg = async <T>(run: (tx: Tx) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    return run(tx);
  });

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;

  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'pipeline@test.local', 'Owner', 'x') returning id`,
  );
  userId = owner.rows[0]!.id;
  orgId = crypto.randomUUID();

  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: orgId, name: 'Sunrise Clinic' });
    const [location] = await tx
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
    locationId = location!.id;
    const [schedule] = await tx
      .insert(schema.schedules)
      .values({
        orgId,
        locationId,
        weekStart: '2026-11-09',
        status: 'published',
        version: 2,
        publishedVersion: 2,
        publishedAt: new Date(),
        publishedBy: userId,
      })
      .returning();
    // Asha chose WhatsApp, and has a phone and an email: the ladder is WhatsApp → email.
    const [asha] = await tx
      .insert(schema.employees)
      .values({
        orgId,
        name: 'Asha Mehta',
        email: 'asha@sunriseclinic.test',
        phone: '+919820000001',
        notifyChannel: 'whatsapp',
        hourlyRateMinor: 45_000,
      })
      .returning();
    ashaId = asha!.id;
    await tx.insert(schema.shifts).values({
      orgId,
      scheduleId: schedule!.id,
      locationId,
      employeeId: ashaId,
      startsAt: new Date('2026-11-09T03:30:00Z'),
      endsAt: new Date('2026-11-09T11:30:00Z'),
      status: 'assigned',
    });
  });
});

afterAll(async () => {
  await database?.stop();
});

function fakeMailer() {
  const sent: { to: string }[] = [];
  const mailer: Mailer = {
    send(message) {
      sent.push(message);
      return Promise.resolve({ messageId: `mail-${sent.length}` });
    },
    close() {
      // nothing to close
    },
  };
  return { mailer, sent };
}

function adaptersWith(whatsapp: FakeMessageSender, mailer: Mailer): Adapters {
  return { mailer, push: null, whatsapp, sms: null };
}

/** A fresh message for Asha, queued on her first rung: WhatsApp. */
async function newWhatsAppDelivery(): Promise<string> {
  const result = await fanOutSchedulePublished(
    db,
    {
      id: crypto.randomUUID(),
      orgId,
      topic: 'schedule.published',
      payload: {
        locationId,
        weekStart: '2026-11-09',
        version: 2,
        added: 1,
        changed: 0,
        removed: 0,
        affectedEmployeeIds: [ashaId],
      },
    },
    ALL_CHANNELS,
  );
  const id = result.deliveryIds[0]!;
  expect(await rowOf(id)).toMatchObject({ channel: 'whatsapp', status: 'queued' });
  return id;
}

async function rowOf(deliveryId: string) {
  const [row] = await asOrg((tx) =>
    tx
      .select({
        channel: schema.deliveries.channel,
        status: schema.deliveries.status,
        attempts: schema.deliveries.attempts,
        lastError: schema.deliveries.lastError,
        deadLetteredAt: schema.deliveries.deadLetteredAt,
      })
      .from(schema.deliveries)
      .where(sql`id = ${deliveryId}`),
  );
  return row!;
}

async function usedThisMonth(): Promise<number> {
  const [row] = await asOrg((tx) =>
    tx
      .select({ count: schema.messageUsage.sentCount })
      .from(schema.messageUsage)
      .where(sql`org_id = ${orgId} and channel = 'whatsapp' and month = ${usageMonth(new Date())}`),
  );
  return row?.count ?? 0;
}

async function setUsage(count: number): Promise<void> {
  await asOrg((tx) =>
    tx.execute(sql`
      insert into message_usage (org_id, month, channel, sent_count)
      values (${orgId}, ${usageMonth(new Date())}, 'whatsapp', ${count})
      on conflict (org_id, month, channel) do update set sent_count = ${count}`),
  );
}

describe('dispatch: how a WhatsApp failure is handled', () => {
  it('a permanent refusal is not retried: it falls back to email at once', async () => {
    await setUsage(0);
    const whatsapp = new FakeMessageSender('whatsapp', 'permanent');
    const id = await newWhatsAppDelivery();

    const outcome = await dispatchDelivery(db, adaptersWith(whatsapp, fakeMailer().mailer), {
      deliveryId: id,
      orgId,
    });

    expect(outcome).toMatchObject({ status: 'failed' });
    expect(await rowOf(id)).toMatchObject({ status: 'failed', deadLetteredAt: null });
    const fallbackId = (outcome as { fallbackDeliveryId: string }).fallbackDeliveryId;
    expect(await rowOf(fallbackId)).toMatchObject({ channel: 'email', status: 'queued' });
    // The refused message is not charged to the quota.
    expect(await usedThisMonth()).toBe(0);
  });

  it('an outage is retried, and on the last attempt it is dead-lettered and falls back', async () => {
    const whatsapp = new FakeMessageSender('whatsapp', 'transient');
    const adapters = adaptersWith(whatsapp, fakeMailer().mailer);
    const id = await newWhatsAppDelivery();

    const early = await dispatchDelivery(db, adapters, { deliveryId: id, orgId });
    expect(early).toEqual({ status: 'retry', reason: 'Fake whatsapp: provider unavailable (503)' });

    const last = await dispatchDelivery(db, adapters, {
      deliveryId: id,
      orgId,
      finalAttempt: true,
    });
    expect(last).toMatchObject({ status: 'dead' });
    const row = await rowOf(id);
    expect(row.deadLetteredAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({ status: 'failed', attempts: 2 });
    const fallbackId = (last as { fallbackDeliveryId: string }).fallbackDeliveryId;
    expect(await rowOf(fallbackId)).toMatchObject({ channel: 'email' });
  });

  it('"slow down" (429) asks for a retry after the provider\'s delay, not a new attempt count', async () => {
    const whatsapp = new FakeMessageSender('whatsapp', 'rate_limited');
    const id = await newWhatsAppDelivery();

    const outcome = await dispatchDelivery(db, adaptersWith(whatsapp, fakeMailer().mailer), {
      deliveryId: id,
      orgId,
      finalAttempt: true, // even on the last attempt: a 429 is about the provider, not the message
    });

    expect(outcome).toEqual({
      status: 'retry',
      reason: 'Fake whatsapp: too many requests',
      retryAfterMs: 1_000,
    });
    expect((await rowOf(id)).deadLetteredAt).toBeNull();
  });
});

describe('the monthly WhatsApp quota', () => {
  it('a sent message is counted', async () => {
    await setUsage(0);
    const whatsapp = new FakeMessageSender('whatsapp');
    const id = await newWhatsAppDelivery();

    await dispatchDelivery(db, adaptersWith(whatsapp, fakeMailer().mailer), {
      deliveryId: id,
      orgId,
    });

    expect(whatsapp.sent).toHaveLength(1);
    expect(await usedThisMonth()).toBe(1);
  });

  it('when it is used up, the message goes by email instead and nothing is sent on WhatsApp', async () => {
    await setUsage(1_000); // one active location = 1,000 a month
    const whatsapp = new FakeMessageSender('whatsapp');
    const id = await newWhatsAppDelivery();

    const outcome = await dispatchDelivery(db, adaptersWith(whatsapp, fakeMailer().mailer), {
      deliveryId: id,
      orgId,
    });

    expect(outcome).toMatchObject({
      status: 'skipped',
      reason: 'Monthly whatsapp quota used up (1000)',
    });
    expect(whatsapp.sent).toHaveLength(0);
    const fallbackId = (outcome as { fallbackDeliveryId: string }).fallbackDeliveryId;
    expect(await rowOf(fallbackId)).toMatchObject({ channel: 'email', status: 'queued' });
    expect(await usedThisMonth()).toBe(1_000);
  });

  it('ten workers racing for the last three messages: exactly three win', async () => {
    await setUsage(997);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveMessage(db, orgId, 'whatsapp', new Date())),
    );

    expect(results.filter((r) => r.reserved)).toHaveLength(3);
    expect(await usedThisMonth()).toBe(1_000);
  });
});

describe('the queue: failure injection → retry → dead letter → replay', () => {
  let container: StartedTestContainer;
  let redis: Redis;
  let queue: Queue<DeliveryJobData>;
  let worker: Worker<DeliveryJobData>;
  const whatsapp = new FakeMessageSender('whatsapp');
  const mail = fakeMailer();

  beforeAll(async () => {
    container = await new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start();
    redis = createRedis(`redis://${container.getHost()}:${container.getMappedPort(6379)}`);
    queue = deliveriesQueue(connectionOptions(redis));
    worker = createDeliveryWorker({
      db,
      adapters: adaptersWith(whatsapp, mail.mailer),
      queue,
      connection: connectionOptions(redis),
      concurrency: 1,
      backoff: () => 10, // the real backoff is seconds to minutes; the behaviour is the same
    });
    await setUsage(0);
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await redis?.quit();
    await container?.stop();
  });

  async function until(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the queue');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  it('a provider that recovers after two failures delivers on the third attempt', async () => {
    whatsapp.failNext('transient', 2);
    const id = await newWhatsAppDelivery();

    await queue.add('delivery', { deliveryId: id, orgId }, { jobId: id });
    await until(async () => (await rowOf(id)).status === 'sent');

    expect(await rowOf(id)).toMatchObject({ status: 'sent', attempts: 3, deadLetteredAt: null });
  });

  it('a provider that never recovers: five attempts, dead-lettered, and Asha gets an email', async () => {
    whatsapp.failAlways('transient');
    const mailsBefore = mail.sent.length;
    const id = await newWhatsAppDelivery();

    await queue.add('delivery', { deliveryId: id, orgId }, { jobId: id });
    await until(() => Promise.resolve(mail.sent.length > mailsBefore));

    const row = await rowOf(id);
    expect(row).toMatchObject({ status: 'failed', attempts: 5 });
    expect(row.deadLetteredAt).toBeInstanceOf(Date);
    expect(mail.sent.at(-1)).toMatchObject({ to: 'asha@sunriseclinic.test' });

    // The provider is back; the owner replays the dead letter (the API resets the row and writes
    // the outbox event — here done by hand) and the worker sends it again.
    whatsapp.failAlways('none');
    await asOrg((tx) =>
      tx
        .update(schema.deliveries)
        .set({ status: 'queued', deadLetteredAt: null, lastError: null, replays: 1 })
        .where(sql`id = ${id}`),
    );
    await handleNotificationJob(
      db,
      {
        deliveries: queue,
        appUrl: 'http://localhost:5173',
        mailer: mail.mailer,
        usable: ALL_CHANNELS,
      },
      {
        outboxId: crypto.randomUUID(),
        orgId,
        topic: 'delivery.replay',
        payload: { deliveryId: id, replays: 1 },
      },
    );
    await until(async () => (await rowOf(id)).status === 'sent');
    expect(whatsapp.sent.at(-1)).toMatchObject({ to: '+919820000001' });
  });
});
