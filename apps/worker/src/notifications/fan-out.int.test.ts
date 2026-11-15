import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { ALL_CHANNELS, type ChannelPolicy } from '@shiftora/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fanOutSchedulePublished } from './fan-out.js';

/**
 * What a worker with SMTP and Web Push can send — the state this repo ships in until the
 * WhatsApp and SMS providers land (W4 D4).
 */
const NO_TEXT_PROVIDERS: ChannelPolicy = { ...ALL_CHANNELS, whatsapp: false, sms: false };

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;
let locationId: string;
let scheduleId: string;
let ashaId: string;
let rohanId: string;
let meeraId: string;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * A clinic with three staff: one on WhatsApp, one on email, one archived — the three paths the
 * fan-out has to take. Built directly for the same reason the seed is: the worker has no HTTP
 * surface to arrange fixtures through.
 */
beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;

  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'fanout@test.local', 'Fanout Owner', 'x') returning id`,
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
        // A published schedule must carry the time it was published (CHECK constraint).
        publishedVersion: 2,
        publishedAt: new Date(),
        publishedBy: userId,
      })
      .returning();
    scheduleId = schedule!.id;

    const [nurse] = await tx.insert(schema.jobRoles).values({ orgId, name: 'Nurse' }).returning();

    const staff = await tx
      .insert(schema.employees)
      .values([
        {
          orgId,
          name: 'Asha Mehta',
          email: 'asha@sunriseclinic.test',
          phone: '+919820000001',
          notifyChannel: 'whatsapp',
          hourlyRateMinor: 45_000,
        },
        {
          orgId,
          name: 'Rohan Desai',
          email: 'rohan@sunriseclinic.test',
          notifyChannel: 'email',
          hourlyRateMinor: 90_000,
        },
        {
          orgId,
          name: 'Meera Iyer',
          email: 'meera@sunriseclinic.test',
          notifyChannel: 'email',
          status: 'archived',
        },
      ])
      .returning();
    ashaId = staff[0]!.id;
    rohanId = staff[1]!.id;
    meeraId = staff[2]!.id;

    // 09:00–17:00 Mumbai (03:30–11:30 UTC) on two days for Asha, one for Rohan.
    await tx
      .insert(schema.shifts)
      .values([
        shift(ashaId, nurse!.id, '2026-11-09T03:30:00Z', '2026-11-09T11:30:00Z'),
        shift(ashaId, nurse!.id, '2026-11-10T03:30:00Z', '2026-11-10T11:30:00Z'),
        shift(rohanId, null, '2026-11-11T04:30:00Z', '2026-11-11T12:30:00Z'),
      ]);
  });
});

afterAll(async () => {
  await database?.stop();
});

async function asOrg<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    return run(tx);
  });
}

function shift(
  employeeId: string,
  jobRoleId: string | null,
  start: string,
  end: string,
): typeof schema.shifts.$inferInsert {
  return {
    orgId,
    scheduleId,
    locationId,
    jobRoleId,
    employeeId,
    startsAt: new Date(start),
    endsAt: new Date(end),
    status: 'assigned',
  };
}

let outboxSeq = 0;

function event(overrides: { employeeIds?: string[]; outboxId?: string } = {}) {
  return {
    // A fresh id per event: the same id twice means "the queue delivered this job again".
    id: overrides.outboxId ?? `00000000-0000-7000-8000-${String(++outboxSeq).padStart(12, '0')}`,
    orgId,
    topic: 'schedule.published',
    payload: {
      locationId,
      weekStart: '2026-11-09',
      version: 2,
      added: 3,
      changed: 0,
      removed: 0,
      affectedEmployeeIds: overrides.employeeIds ?? [ashaId, rohanId, meeraId],
    },
  };
}

describe('schedule.published fan-out', () => {
  it('writes one message per affected person, on the channel they asked for', async () => {
    const result = await fanOutSchedulePublished(db, event(), ALL_CHANNELS);

    // The archived employee is skipped: no message goes to someone who has left.
    expect(result).toMatchObject({ notifications: 2, deliveries: 2 });
    expect(result.deliveryIds).toHaveLength(2);

    const messages = await asOrg((tx) =>
      tx
        .select({
          employeeId: schema.notifications.employeeId,
          subject: schema.notifications.subject,
          body: schema.notifications.body,
        })
        .from(schema.notifications),
    );
    expect(messages).toHaveLength(2);

    const asha = messages.find((message) => message.employeeId === ashaId);
    expect(asha?.subject).toBe('Your shifts at Andheri · 9–15 Nov');
    expect(asha?.body).toContain('Hi Asha, your week at Sunrise Clinic — Andheri is published.');
    expect(asha?.body).toContain('Mon 9 Nov · 09:00–17:00 (8h) · Nurse');
    expect(asha?.body).toContain('Tue 10 Nov · 09:00–17:00 (8h) · Nurse');

    const deliveries = await asOrg((tx) =>
      tx
        .select({
          channel: schema.deliveries.channel,
          address: schema.deliveries.address,
          status: schema.deliveries.status,
        })
        .from(schema.deliveries),
    );
    expect(deliveries).toHaveLength(2);
    expect(deliveries).toEqual(
      expect.arrayContaining([
        { channel: 'whatsapp', address: '+919820000001', status: 'queued' },
        { channel: 'email', address: 'rohan@sunriseclinic.test', status: 'queued' },
      ]),
    );
  });

  it('moves a WhatsApp person down the ladder when no WhatsApp provider is configured', async () => {
    const kiran = await asOrg(async (tx) => {
      const [row] = await tx
        .insert(schema.employees)
        .values({
          orgId,
          name: 'Kiran Rao',
          email: 'kiran@sunriseclinic.test',
          phone: '+919820000009',
          notifyChannel: 'whatsapp',
        })
        .returning({ id: schema.employees.id });
      return row!.id;
    });

    const result = await fanOutSchedulePublished(
      db,
      event({ employeeIds: [kiran] }),
      NO_TEXT_PROVIDERS,
    );
    expect(result).toMatchObject({ notifications: 1, deliveries: 1 });

    const [delivery] = await asOrg((tx) =>
      tx
        .select({
          channel: schema.deliveries.channel,
          address: schema.deliveries.address,
          status: schema.deliveries.status,
        })
        .from(schema.deliveries)
        .where(sql`notification_id in (select id from notifications where employee_id = ${kiran})`),
    );

    // Their choice is WhatsApp and this worker has no WhatsApp sender, so the ladder moves down:
    // an email they can read beats a delivery row that can only ever fail. Choosing a channel the
    // deployment cannot send on is a routing problem, not a queue problem.
    expect(delivery).toMatchObject({
      channel: 'email',
      address: 'kiran@sunriseclinic.test',
      status: 'queued',
    });
  });

  it('only offers push to someone with a subscribed device', async () => {
    const [subscribed, unsubscribed] = await asOrg(async (tx) => {
      const rows = await tx
        .insert(schema.employees)
        .values([
          { orgId, name: 'Devika Nair', email: 'devika@sunriseclinic.test', notifyChannel: 'push' },
          { orgId, name: 'Karan Shah', email: 'karan@sunriseclinic.test', notifyChannel: 'push' },
        ])
        .returning({ id: schema.employees.id });

      await tx.insert(schema.pushSubscriptions).values({
        orgId,
        employeeId: rows[0]!.id,
        endpoint: 'https://fcm.googleapis.com/fcm/send/fan-out-test',
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
      });
      return [rows[0]!.id, rows[1]!.id] as const;
    });

    await fanOutSchedulePublished(
      db,
      event({ employeeIds: [subscribed, unsubscribed] }),
      ALL_CHANNELS,
    );

    const rows = await asOrg((tx) =>
      tx
        .select({ employeeId: schema.notifications.employeeId, channel: schema.deliveries.channel })
        .from(schema.deliveries)
        .innerJoin(schema.notifications, sql`notifications.id = deliveries.notification_id`)
        .where(sql`notifications.employee_id in (${subscribed}, ${unsubscribed})`),
    );

    // The device count is read from `push_subscriptions`: a preference is not a subscription, and
    // assuming zero devices (as the first version did) made the push rung unreachable for good.
    const channelFor = new Map(rows.map((row) => [row.employeeId, row.channel]));
    expect(channelFor.get(subscribed)).toBe('push');
    expect(channelFor.get(unsubscribed)).toBe('email');
  });

  it('does nothing the second time the same event arrives', async () => {
    const first = event();
    await fanOutSchedulePublished(db, first, ALL_CHANNELS);
    const before = await counts();

    const replay = await fanOutSchedulePublished(db, first, ALL_CHANNELS);

    // The queue may deliver a job twice after a crash; the staff still get one message.
    expect(replay).toMatchObject({ notifications: 0, deliveries: 0, deliveryIds: [] });
    expect(await counts()).toEqual(before);
  });

  it('records a skipped delivery when a person has nowhere to be reached', async () => {
    const noAddressId = await asOrg(async (tx) => {
      const [row] = await tx
        .insert(schema.employees)
        .values({ orgId, name: 'Nobody Reachable', notifyChannel: 'email' })
        .returning({ id: schema.employees.id });
      return row!.id;
    });

    const result = await fanOutSchedulePublished(
      db,
      event({ employeeIds: [noAddressId] }),
      ALL_CHANNELS,
    );
    expect(result).toMatchObject({ notifications: 1, deliveries: 1 });

    const [delivery] = await asOrg((tx) =>
      tx
        .select({
          channel: schema.deliveries.channel,
          status: schema.deliveries.status,
          error: schema.deliveries.lastError,
        })
        .from(schema.deliveries)
        .where(
          sql`notification_id in (select id from notifications where employee_id = ${noAddressId})`,
        ),
    );
    // Email is the fallback, but with no address it is a recorded decision, not a silent drop.
    expect(delivery).toMatchObject({ channel: 'email', status: 'skipped' });
    expect(delivery?.error).toContain('No email address');
  });

  it('tells a person with nothing rostered that the week has nothing on it', async () => {
    const id = await asOrg(async (tx) => {
      const [row] = await tx
        .insert(schema.employees)
        .values({ orgId, name: 'Sunil Rao', email: 'sunil@sunriseclinic.test' })
        .returning({ id: schema.employees.id });
      return row!.id;
    });

    await fanOutSchedulePublished(db, event({ employeeIds: [id] }), ALL_CHANNELS);
    const [message] = await asOrg((tx) =>
      tx
        .select({ body: schema.notifications.body })
        .from(schema.notifications)
        .where(sql`employee_id = ${id}`),
    );
    expect(message?.body).toContain('Nothing is rostered for you from 9–15 Nov.');
  });
});

/** Row counts for the tenant, for assertions that must not depend on test order. */
async function counts(): Promise<{ notifications: string; deliveries: string }> {
  return asOrg(async (tx) => {
    const notifications = await tx.execute<{ count: string }>(
      sql`select count(*) from notifications`,
    );
    const deliveries = await tx.execute<{ count: string }>(sql`select count(*) from deliveries`);
    return { notifications: notifications.rows[0]!.count, deliveries: deliveries.rows[0]!.count };
  });
}
