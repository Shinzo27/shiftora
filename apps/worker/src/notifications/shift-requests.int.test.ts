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

import { scanShiftAlerts } from '../alerts/scan.js';
import type { OutboxEvent } from '../outbox-relay.js';
import { handleShiftRequestEvent } from './shift-requests.js';

/**
 * W5 D2: each step of a swap or drop tells the right people — the colleague when asked, the
 * location's managers when it needs a decision, the people whose rota changes when it is
 * decided — once per event. And a request nobody decided expires when its shift starts.
 */

let database: TestDatabase;
let db: Database;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const org = {
  id: crypto.randomUUID(),
  ownerId: '',
  ownerEmail: 'priya@clinic.test',
  locationId: '',
  scheduleId: '',
};
const people = { asha: '', rohan: '' };
const deps = { usable: ALL_CHANNELS, appUrl: 'http://app.test' };

const asOrg = <T>(run: (tx: Tx) => Promise<T>) =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId: org.ownerId, orgId: org.id });
    return run(tx);
  });

async function user(name: string, email: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, ${email}, ${name}, 'x') returning id`,
  );
  return rows.rows[0]!.id;
}

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;
  org.ownerId = await user('Priya Nair', org.ownerEmail);
  const bandraManager = await user('Bina Rao', 'bina@clinic.test');

  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: org.id, name: 'Sunrise Clinic' });
    await tx.insert(schema.memberships).values([
      { orgId: org.id, userId: org.ownerId, role: 'owner' },
      { orgId: org.id, userId: bandraManager, role: 'manager' },
    ]);
    const [andheri, bandra] = await tx
      .insert(schema.locations)
      .values([
        {
          orgId: org.id,
          name: 'Andheri',
          latitude: 19.11,
          longitude: 72.84,
          radiusM: 120,
          timezone: 'Asia/Kolkata',
        },
        {
          orgId: org.id,
          name: 'Bandra',
          latitude: 19.06,
          longitude: 72.83,
          radiusM: 120,
          timezone: 'Asia/Kolkata',
        },
      ])
      .returning();
    org.locationId = andheri!.id;
    // Bina looks after Bandra only: she must not hear about Andheri's requests.
    await tx
      .insert(schema.membershipLocations)
      .values({ orgId: org.id, userId: bandraManager, locationId: bandra!.id });
    const [schedule] = await tx
      .insert(schema.schedules)
      .values({ orgId: org.id, locationId: org.locationId, weekStart: '2026-11-30' })
      .returning();
    org.scheduleId = schedule!.id;
    const [asha, rohan] = await tx
      .insert(schema.employees)
      .values([
        {
          orgId: org.id,
          name: 'Asha Mehta',
          email: 'asha@clinic.test',
          notifyChannel: 'email' as const,
          hourlyRateMinor: 40_000,
        },
        {
          orgId: org.id,
          name: 'Rohan Desai',
          email: 'rohan@clinic.test',
          notifyChannel: 'email' as const,
          hourlyRateMinor: 40_000,
        },
      ])
      .returning();
    people.asha = asha!.id;
    people.rohan = rohan!.id;
  });
});

afterAll(async () => {
  await database?.stop();
});

let dayOffset = 0;

/** A shift for Asha; each call gets its own day, so the no-double-booking rule never trips. */
async function shiftFor(startsAt?: Date): Promise<string> {
  dayOffset += 1;
  const start = startsAt ?? new Date(Date.UTC(2026, 11, dayOffset, 3, 30));
  return asOrg(async (tx) => {
    const [row] = await tx
      .insert(schema.shifts)
      .values({
        orgId: org.id,
        scheduleId: org.scheduleId,
        locationId: org.locationId,
        employeeId: people.asha,
        startsAt: start,
        endsAt: new Date(start.getTime() + 8 * 60 * 60_000),
        status: 'assigned',
      })
      .returning();
    return row!.id;
  });
}

async function request(type: 'swap' | 'drop', startsAt?: Date) {
  const shiftId = await shiftFor(startsAt);
  return asOrg(async (tx) => {
    const [row] = await tx
      .insert(schema.shiftRequests)
      .values({
        orgId: org.id,
        type,
        status: type === 'swap' ? 'pending_colleague' : 'pending_manager',
        shiftId,
        requesterEmployeeId: people.asha,
        targetEmployeeId: type === 'swap' ? people.rohan : null,
        note: 'Family wedding',
      })
      .returning();
    return row!;
  });
}

async function event(topic: string, requestId: string): Promise<OutboxEvent> {
  return asOrg(async (tx) => {
    const [row] = await tx
      .insert(schema.outbox)
      .values({ orgId: org.id, topic, payload: { requestId } })
      .returning();
    return { id: row!.id, orgId: org.id, topic, payload: row!.payload };
  });
}

/** Who this event messaged: employee names, or manager email addresses. */
async function recipients(outboxId: string): Promise<{ who: string; subject: string }[]> {
  const rows = await asOrg((tx) =>
    tx
      .select({
        employee: schema.employees.name,
        email: schema.notifications.recipientEmail,
        subject: schema.notifications.subject,
      })
      .from(schema.notifications)
      .leftJoin(schema.employees, sql`${schema.employees.id} = ${schema.notifications.employeeId}`)
      .where(sql`${schema.notifications.outboxId} = ${outboxId}`),
  );
  return rows
    .map((row) => ({ who: row.employee ?? row.email ?? '?', subject: row.subject }))
    .sort((a, b) => a.who.localeCompare(b.who));
}

describe('who hears about a request', () => {
  it('a new swap asks the colleague, and only the colleague', async () => {
    const swap = await request('swap');
    const created = await event('shift_request.created', swap.id);

    const result = await handleShiftRequestEvent(db, created, deps);

    expect(result).toMatchObject({ notifications: 1, deliveries: 1 });
    const [only] = await recipients(created.id);
    expect(await recipients(created.id)).toHaveLength(1);
    expect(only!.who).toBe('Rohan Desai');
    expect(only!.subject).toMatch(/^Asha Mehta asks you to take a shift · /);
  });

  it('a drop goes to the managers of that location, by email (not the Bandra manager)', async () => {
    const drop = await request('drop');
    const created = await event('shift_request.created', drop.id);
    await handleShiftRequestEvent(db, created, deps);

    const sent = await recipients(created.id);
    expect(sent.map((r) => r.who)).toEqual([org.ownerEmail]);
    expect(sent[0]!.subject).toMatch(/^Asha Mehta asks to drop a shift · /);
  });

  it('an approved swap tells both people whose rota changed', async () => {
    const swap = await request('swap');
    const approved = await event('shift_request.approved', swap.id);
    await handleShiftRequestEvent(db, approved, deps);

    expect((await recipients(approved.id)).map((r) => r.who)).toEqual([
      'Asha Mehta',
      'Rohan Desai',
    ]);
  });

  it('a declined swap tells the requester', async () => {
    const swap = await request('swap');
    const declined = await event('shift_request.declined', swap.id);
    await handleShiftRequestEvent(db, declined, deps);

    const sent = await recipients(declined.id);
    expect(sent.map((r) => r.who)).toEqual(['Asha Mehta']);
    expect(sent[0]!.subject).toMatch(/^Rohan Desai can’t take your shift · /);
  });

  it('the same event handled twice sends once', async () => {
    const swap = await request('swap');
    const created = await event('shift_request.created', swap.id);
    await handleShiftRequestEvent(db, created, deps);
    const again = await handleShiftRequestEvent(db, created, deps);

    expect(again).toMatchObject({ notifications: 0, deliveries: 0 });
    expect(await recipients(created.id)).toHaveLength(1);
  });
});

describe('expiry', () => {
  it('the minute scan closes a request whose shift started, and leaves the others', async () => {
    const started = await request('drop', new Date('2027-01-10T03:30:00Z'));
    const later = await request('drop', new Date('2027-01-11T03:30:00Z'));

    const result = await scanShiftAlerts(db, new Date('2027-01-10T04:00:00Z'));

    expect(result.expired).toBeGreaterThanOrEqual(1);
    const rows = await asOrg((tx) =>
      tx
        .select({
          id: schema.shiftRequests.id,
          status: schema.shiftRequests.status,
          decidedBy: schema.shiftRequests.decidedBy,
        })
        .from(schema.shiftRequests)
        .where(sql`id in (${started.id}, ${later.id})`),
    );
    expect(rows.find((r) => r.id === started.id)).toMatchObject({
      status: 'expired',
      decidedBy: null,
    });
    expect(rows.find((r) => r.id === later.id)?.status).toBe('pending_manager');
  });
});
