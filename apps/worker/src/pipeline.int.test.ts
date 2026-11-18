import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import type { Redis } from 'ioredis';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from './logging.js';
import type { Mailer } from './mailer.js';
import { FakeMessageSender, type FakeReport } from './notifications/fake-sender.js';
import { startPipeline, type Pipeline } from './pipeline.js';
import { connectionOptions, createRedis } from './queues.js';

/**
 * W4 D6, end to end inside the worker: an outbox row → the relay → the fan-out → the providers →
 * their delivery reports → fallback, on a real Postgres and a real Redis, with the same wiring
 * main.ts runs (`startPipeline`). The fake WhatsApp provider's reports are written as the API's
 * webhook writes them: a `delivery.reported` platform outbox row.
 *
 * Failure injection is the point: a healthy provider, one that accepts and then cannot deliver,
 * and one that is down for every retry. In every case the person hears about their week.
 */

let database: TestDatabase;
let db: Database;
let redisContainer: StartedTestContainer;
let redis: Redis;
let pipeline: Pipeline;
let relayTimer: NodeJS.Timeout;

/** Everything the pipeline logs, parsed: the trace test reads one request's journey from it. */
const logLines: Record<string, unknown>[] = [];

const mail: { to: string; subject: string }[] = [];
const mailer: Mailer = {
  send(message) {
    mail.push({ to: message.to, subject: message.subject });
    return Promise.resolve({ messageId: `mail-${mail.length}` });
  },
  close: () => undefined,
};

/** Like a phone: the report comes a moment after the provider accepted the message. */
const reportDelayMs = 200;

/** What the API's webhook does with a verified report: one platform outbox row. */
function reportLikeTheWebhook(report: FakeReport): void {
  // Drizzle queries are lazy: nothing is sent until the query is awaited (or `.then` is called).
  setTimeout(() => {
    insertReport(report).then(
      () => undefined,
      (error: unknown) => console.error('report insert failed', error),
    );
  }, reportDelayMs);
}

function insertReport(report: FakeReport) {
  return db.insert(schema.outbox).values({
    orgId: null,
    topic: 'delivery.reported',
    payload: {
      channel: 'whatsapp',
      reports: [
        {
          messageId: report.messageId,
          status: report.status,
          at: report.at.toISOString(),
          ...(report.error ? { error: report.error } : {}),
        },
      ],
    },
  });
}
const whatsapp = new FakeMessageSender('whatsapp', 'none', () => undefined, reportLikeTheWebhook);

const org = { id: crypto.randomUUID(), ownerId: '', locationId: '', scheduleId: '' };
const people = { asha: '', meera: '' };
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const asOrg = <T>(run: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId: org.ownerId, orgId: org.id });
    return run(tx);
  });

const NOW = Date.now();
const WEEK_START = '2026-11-16';

beforeAll(async () => {
  [database, redisContainer] = await Promise.all([
    startTestDatabase(),
    new GenericContainer('redis:7.4-alpine').withExposedPorts(6379).start(),
  ]);
  db = createDatabaseConnection(database.urlFor('app_user')).db;
  redis = createRedis(`redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`);

  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'e2e-owner@test.local', 'Priya Shah', 'x') returning id`,
  );
  org.ownerId = owner.rows[0]!.id;
  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: org.id, name: 'Sunrise Clinic' });
    await tx
      .insert(schema.memberships)
      .values({ orgId: org.id, userId: org.ownerId, role: 'owner' });
    const [location] = await tx
      .insert(schema.locations)
      .values({
        orgId: org.id,
        name: 'Andheri',
        latitude: 19.1197,
        longitude: 72.8468,
        radiusM: 120,
        timezone: 'Asia/Kolkata',
      })
      .returning();
    org.locationId = location!.id;
    const [schedule] = await tx
      .insert(schema.schedules)
      .values({
        orgId: org.id,
        locationId: org.locationId,
        weekStart: WEEK_START,
        status: 'published',
        version: 1,
        publishedVersion: 1,
        publishedAt: new Date(),
        publishedBy: org.ownerId,
      })
      .returning();
    org.scheduleId = schedule!.id;
    const [asha, meera] = await tx
      .insert(schema.employees)
      .values([
        {
          orgId: org.id,
          name: 'Asha Mehta',
          email: 'asha@sunriseclinic.test',
          phone: '+919820000001',
          notifyChannel: 'whatsapp' as const,
          hourlyRateMinor: 45_000,
        },
        {
          orgId: org.id,
          name: 'Meera Iyer',
          email: 'meera@sunriseclinic.test',
          notifyChannel: 'email' as const,
          hourlyRateMinor: 40_000,
        },
      ])
      .returning();
    people.asha = asha!.id;
    people.meera = meera!.id;
  });

  pipeline = await startPipeline({
    db,
    connection: connectionOptions(redis),
    adapters: { mailer, push: null, whatsapp, sms: null },
    appUrl: 'http://app.test',
    concurrency: 5,
    relayBatch: 50,
    alertScanIntervalMs: null,
    backoff: () => 10,
    logger: createLogger({
      level: 'info',
      destination: {
        write: (line: string) => void logLines.push(JSON.parse(line) as Record<string, unknown>),
      },
    }),
  });
  relayTimer = setInterval(() => void pipeline.relay().catch(() => undefined), 100);
});

afterAll(async () => {
  clearInterval(relayTimer);
  await pipeline?.close();
  await redis?.quit();
  await redisContainer?.stop();
  await database?.stop();
});

/** What the API writes when a manager presses Publish: one `schedule.published` outbox row. */
async function publishWeek(traceId?: string): Promise<string> {
  return asOrg(async (tx) => {
    const [event] = await tx
      .insert(schema.outbox)
      .values({
        orgId: org.id,
        ...(traceId ? { traceId } : {}),
        topic: 'schedule.published',
        payload: {
          scheduleId: org.scheduleId,
          locationId: org.locationId,
          weekStart: WEEK_START,
          version: 1,
          added: 1,
          changed: 0,
          removed: 0,
          affectedEmployeeIds: [people.asha, people.meera],
        },
      })
      .returning();
    return event!.id;
  });
}

async function deliveriesFor(outboxId: string) {
  return asOrg((tx) =>
    tx
      .select({
        employeeId: schema.notifications.employeeId,
        channel: schema.deliveries.channel,
        status: schema.deliveries.status,
        attempts: schema.deliveries.attempts,
        readAt: schema.deliveries.readAt,
        deadLetteredAt: schema.deliveries.deadLetteredAt,
        lastError: schema.deliveries.lastError,
      })
      .from(schema.deliveries)
      .innerJoin(
        schema.notifications,
        sql`${schema.notifications.id} = ${schema.deliveries.notificationId}`,
      )
      .where(sql`${schema.notifications.outboxId} = ${outboxId}`),
  );
}

type Row = Awaited<ReturnType<typeof deliveriesFor>>[number];
const of = (rows: Row[], who: string, channel: string): Row | undefined =>
  rows.find((row) => row.employeeId === who && row.channel === channel);

/** Waits for a delivery of `who` on `channel` to satisfy `done`, then returns it. */
async function eventually(
  outboxId: string,
  who: string,
  channel: string,
  done: (row: Row) => boolean,
  timeout = 20_000,
): Promise<Row> {
  await expect
    .poll(
      async () => {
        const row = of(await deliveriesFor(outboxId), who, channel);
        return row ? done(row) : false;
      },
      { timeout, interval: 100 },
    )
    .toBe(true);
  return of(await deliveriesFor(outboxId), who, channel)!;
}

describe('publish → messages, end to end', () => {
  it('healthy: Asha’s WhatsApp is delivered and read, Meera is emailed', async () => {
    whatsapp.failAlways('none');
    const mailBefore = mail.length;
    const event = await publishWeek();

    const asha = await eventually(event, people.asha, 'whatsapp', (row) => row.readAt !== null);
    await eventually(event, people.meera, 'email', (row) => row.status === 'sent');

    expect(asha).toMatchObject({ status: 'delivered', attempts: 1 });
    // Nobody got a second channel: no fallback was needed.
    expect(await deliveriesFor(event)).toHaveLength(2);
    expect(mail.slice(mailBefore).map((m) => m.to)).toEqual(['meera@sunriseclinic.test']);
  });

  it('accepted, then undeliverable: the report fails the WhatsApp and Asha is emailed', async () => {
    whatsapp.failAlways('undeliverable');
    const event = await publishWeek();

    await eventually(event, people.asha, 'email', (row) => row.status === 'sent');

    expect(of(await deliveriesFor(event), people.asha, 'whatsapp')).toMatchObject({
      status: 'failed',
      lastError: 'WhatsApp: Message undeliverable',
      deadLetteredAt: null, // a provider's verdict, not an exhausted queue
    });
    expect(mail.some((m) => m.to === 'asha@sunriseclinic.test')).toBe(true);
  });

  it('provider down for every retry: five attempts, dead-lettered, and Asha is emailed', async () => {
    whatsapp.failAlways('transient');
    const event = await publishWeek();

    await eventually(event, people.asha, 'email', (row) => row.status === 'sent');

    const failed = of(await deliveriesFor(event), people.asha, 'whatsapp');
    expect(failed).toMatchObject({ status: 'failed', attempts: 5 });
    expect(failed?.deadLetteredAt).toBeInstanceOf(Date);
  });

  it('a reminder travels the same road: scan → outbox → WhatsApp → read', async () => {
    whatsapp.failAlways('none');
    const startsAt = new Date(NOW + 90 * 60_000);
    const shiftId = await asOrg(async (tx) => {
      const [shift] = await tx
        .insert(schema.shifts)
        .values({
          orgId: org.id,
          scheduleId: org.scheduleId,
          locationId: org.locationId,
          employeeId: people.asha,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
          status: 'assigned',
        })
        .returning();
      await tx.insert(schema.schedulePublications).values({
        orgId: org.id,
        scheduleId: org.scheduleId,
        version: 1,
        shifts: [
          {
            shiftId: shift!.id,
            employeeId: people.asha,
            date: WEEK_START,
            startTime: '00:00',
            endTime: '04:00',
            breakMinutes: 0,
            jobRoleId: null,
          },
        ],
        affectedEmployeeIds: [people.asha],
      });
      return shift!.id;
    });

    expect((await pipeline.scan(new Date(NOW))).reminders).toBe(1);
    const [event] = await asOrg((tx) =>
      tx
        .select({ id: schema.outbox.id })
        .from(schema.outbox)
        .where(sql`topic = 'shift.reminder' and payload->>'shiftId' = ${shiftId}`),
    );

    await eventually(event!.id, people.asha, 'whatsapp', (row) => row.readAt !== null);
    // A second scan in the same window raises nothing new.
    expect((await pipeline.scan(new Date(NOW + 60_000))).reminders).toBe(0);
  });

  it('the same event queued twice sends once', async () => {
    whatsapp.failAlways('none');
    const event = await publishWeek();
    await eventually(event, people.meera, 'email', (row) => row.status === 'sent');
    const sentBefore = whatsapp.sent.length;

    // A relay crash between enqueue and commit re-queues the event under the same job id.
    await pipeline.notifications.add(
      'schedule.published',
      { outboxId: event, orgId: org.id, topic: 'schedule.published', payload: {} },
      { jobId: event },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await deliveriesFor(event)).toHaveLength(2);
    expect(whatsapp.sent.length).toBe(sentBefore);
  });
});

describe('one trace from publish to provider (W7 D5)', () => {
  it('the relay, the fan-out and every send log under the trace the API wrote', async () => {
    whatsapp.failAlways('none');
    const trace = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const event = await publishWeek(trace);

    await eventually(
      event,
      people.asha,
      'whatsapp',
      (row) => row.status === 'delivered' || row.readAt !== null,
    );
    await eventually(event, people.meera, 'email', (row) => row.status === 'sent');

    const mine = logLines.filter((line) => line['traceId'] === trace);
    const steps = mine.map((line) => line['msg']);
    expect(steps).toContain('relay: queued');
    expect(steps).toContain('notifications: handled');
    expect(steps.filter((msg) => msg === 'delivery: sent')).toHaveLength(2);
    // Every step knows the organisation and its queue.
    for (const line of mine) {
      expect(line, String(line['msg'])).toMatchObject({ service: 'worker', orgId: org.id });
      expect(['outbox', 'notifications', 'deliveries']).toContain(line['queue']);
    }
    // And no address reached the log.
    const text = JSON.stringify(logLines);
    expect(text).not.toContain('meera@sunriseclinic.test');
    expect(text).not.toMatch(/\+91\d{10}/);
  });
});
