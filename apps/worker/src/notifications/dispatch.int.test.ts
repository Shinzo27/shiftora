import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { ALL_CHANNELS } from '@shiftora/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Mailer } from '../mailer.js';
import { dispatchDelivery, type MessageSender } from './dispatch.js';
import { fanOutSchedulePublished } from './fan-out.js';

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;
let ashaId: string;
let locationId: string;
let scheduleId: string;

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
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'dispatch@test.local', 'Owner', 'x') returning id`,
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
    scheduleId = schedule!.id;

    const [asha] = await tx
      .insert(schema.employees)
      .values({
        orgId,
        name: 'Asha Mehta',
        email: 'asha@sunriseclinic.test',
        notifyChannel: 'email',
        hourlyRateMinor: 45_000,
      })
      .returning();
    ashaId = asha!.id;

    await tx.insert(schema.shifts).values({
      orgId,
      scheduleId,
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

/** Records what it was asked to send; `failWith` makes it throw like a broken relay would. */
function fakeMailer(failWith?: string) {
  const sent: { to: string; subject: string; body: string }[] = [];
  const mailer: Mailer = {
    send(message) {
      if (failWith) return Promise.reject(new Error(failWith));
      sent.push(message);
      return Promise.resolve({ messageId: `fake-${sent.length}` });
    },
    close() {
      // nothing to close
    },
  };
  return { mailer, sent };
}

/** A stand-in WhatsApp/SMS provider, so the text path is testable without Meta or Twilio. */
function fakeSender(failWith?: string) {
  const sent: { to: string; subject: string; body: string }[] = [];
  const sender: MessageSender = {
    send(message) {
      if (failWith) return Promise.reject(new Error(failWith));
      sent.push(message);
      return Promise.resolve({ messageId: `fake-${sent.length}` });
    },
  };
  return { sender, sent };
}

/**
 * The worker as it ships today: SMTP and Web Push, no WhatsApp or SMS provider.
 * A channel in this state is never offered by routing, and dispatching one is a skip.
 */
const emailOnly = (mailer: Mailer) => ({ mailer, push: null, whatsapp: null, sms: null });

async function queueOneDelivery(): Promise<{ deliveryId: string; body: string }> {
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

  const deliveryId = result.deliveryIds[0]!;
  const [row] = await asOrg((tx) =>
    tx
      .select({ body: schema.notifications.body })
      .from(schema.deliveries)
      .innerJoin(schema.notifications, sql`notifications.id = deliveries.notification_id`)
      .where(sql`deliveries.id = ${deliveryId}`),
  );
  return { deliveryId, body: row!.body };
}

describe('dispatchDelivery', () => {
  it('sends an email and records it as sent', async () => {
    const { deliveryId, body } = await queueOneDelivery();
    const { mailer, sent } = fakeMailer();

    const outcome = await dispatchDelivery(db, emailOnly(mailer), { deliveryId, orgId });

    expect(outcome).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'asha@sunriseclinic.test' });
    expect(sent[0]!.subject).toContain('Your shifts at Andheri');
    expect(sent[0]!.body).toBe(body);

    const [row] = await asOrg((tx) =>
      tx
        .select({
          status: schema.deliveries.status,
          attempts: schema.deliveries.attempts,
          sentAt: schema.deliveries.sentAt,
        })
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    expect(row).toMatchObject({ status: 'sent', attempts: 1 });
    expect(row?.sentAt).not.toBeNull();
  });

  it('does not send the same delivery twice', async () => {
    const { deliveryId } = await queueOneDelivery();
    const { mailer, sent } = fakeMailer();

    await dispatchDelivery(db, emailOnly(mailer), { deliveryId, orgId });
    const again = await dispatchDelivery(db, emailOnly(mailer), { deliveryId, orgId });

    expect(again.status).toBe('skipped');
    expect(sent).toHaveLength(1);
  });

  it('records the provider error and asks for a retry', async () => {
    const { deliveryId } = await queueOneDelivery();

    const outcome = await dispatchDelivery(db, emailOnly(fakeMailer('SMTP 421 try later').mailer), {
      deliveryId,
      orgId,
    });

    expect(outcome).toEqual({ status: 'retry', reason: 'SMTP 421 try later' });

    const [row] = await asOrg((tx) =>
      tx
        .select({
          status: schema.deliveries.status,
          error: schema.deliveries.lastError,
          attempts: schema.deliveries.attempts,
        })
        .from(schema.deliveries)
        .where(sql`id = ${deliveryId}`),
    );
    // The row keeps the reason, so an operator can see why without the queue's failed list.
    expect(row).toMatchObject({ status: 'failed', error: 'SMTP 421 try later', attempts: 1 });
  });

  it('records a skip, not a retry, when the channel has no sender', async () => {
    const { deliveryId } = await queueOneDelivery();
    await moveTo(deliveryId, 'whatsapp', '+919820000001');

    const outcome = await dispatchDelivery(db, emailOnly(fakeMailer().mailer), {
      deliveryId,
      orgId,
    });

    // A missing provider is permanent: retrying cannot conjure one. Five failed attempts would
    // also hide "nobody was told about this week" behind a queue that looks like it is trying.
    expect(outcome).toEqual({ status: 'skipped', reason: 'No whatsapp sender is configured' });
    expect(await statusOf(deliveryId)).toBe('skipped');
    expect(await reasonOf(deliveryId)).toBe('No whatsapp sender is configured');
  });

  it('sends through the WhatsApp sender once one is configured', async () => {
    const { deliveryId, body } = await queueOneDelivery();
    await moveTo(deliveryId, 'whatsapp', '+919820000001');
    const { sender, sent } = fakeSender();

    const outcome = await dispatchDelivery(
      db,
      { ...emailOnly(fakeMailer().mailer), whatsapp: sender },
      { deliveryId, orgId },
    );

    expect(outcome).toEqual({ status: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: '+919820000001' });
    // The same rendered message, not a second template: one body for every channel.
    expect(sent[0]!.body).toBe(body);
    expect(await statusOf(deliveryId)).toBe('sent');
  });

  it('asks for a retry when the provider itself fails', async () => {
    const { deliveryId } = await queueOneDelivery();
    await moveTo(deliveryId, 'whatsapp', '+919820000001');

    const outcome = await dispatchDelivery(
      db,
      { ...emailOnly(fakeMailer().mailer), whatsapp: fakeSender('429 rate limited').sender },
      { deliveryId, orgId },
    );

    expect(outcome).toEqual({ status: 'retry', reason: '429 rate limited' });
    expect(await statusOf(deliveryId)).toBe('failed');
    expect(await reasonOf(deliveryId)).toBe('429 rate limited');
  });
});

/** Points an already-queued delivery at another channel, as a stored row from an earlier run would. */
async function moveTo(deliveryId: string, channel: 'whatsapp' | 'sms', address: string) {
  await asOrg(async (tx) => {
    await tx
      .update(schema.deliveries)
      .set({ channel, address })
      .where(sql`id = ${deliveryId}`);
  });
}

async function statusOf(deliveryId: string): Promise<string> {
  const [row] = await asOrg((tx) =>
    tx
      .select({ status: schema.deliveries.status })
      .from(schema.deliveries)
      .where(sql`id = ${deliveryId}`),
  );
  return row?.status ?? '';
}

async function reasonOf(deliveryId: string): Promise<string> {
  const [row] = await asOrg((tx) =>
    tx
      .select({ error: schema.deliveries.lastError })
      .from(schema.deliveries)
      .where(sql`id = ${deliveryId}`),
  );
  return row?.error ?? '';
}
