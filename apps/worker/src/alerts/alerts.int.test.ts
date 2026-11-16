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

import type { OutboxEvent } from '../outbox-relay.js';
import { handleMissedClockIn, handleShiftReminder } from './handlers.js';
import { scanShiftAlerts } from './scan.js';

/**
 * W4 D5: the minute-by-minute scan raises a reminder two hours before a published shift and a
 * missed clock-in alert after the grace — each exactly once — and the handlers turn them into
 * messages for the right people.
 */

let database: TestDatabase;
let db: Database;

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const NOW = new Date('2026-11-16T03:30:00Z'); // Monday 09:00 in Asia/Kolkata
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const deps = { usable: ALL_CHANNELS, appUrl: 'http://app.test' };

interface Org {
  id: string;
  ownerId: string;
  locationId: string;
  scheduleId: string;
  /** Shifts in the latest publication: what staff were told. */
  published: { shiftId: string; employeeId: string }[];
}

const asOrg = async <T>(org: Org, run: (tx: Tx) => Promise<T>): Promise<T> =>
  db.transaction(async (tx) => {
    await setTenantContext(tx, { userId: org.ownerId, orgId: org.id });
    return run(tx);
  });

async function newUser(name: string): Promise<{ id: string; email: string }> {
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}.${crypto.randomUUID().slice(0, 8)}@test.local`;
  const rows = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, ${email}, ${name}, 'x') returning id`,
  );
  return { id: rows.rows[0]!.id, email };
}

async function createOrg(name: string): Promise<Org> {
  const owner = await newUser('Priya Shah');
  const org: Org = {
    id: crypto.randomUUID(),
    ownerId: owner.id,
    locationId: '',
    scheduleId: '',
    published: [],
  };
  await asOrg(org, async (tx) => {
    await tx.insert(schema.organizations).values({ id: org.id, name });
    await tx.insert(schema.memberships).values({ orgId: org.id, userId: owner.id, role: 'owner' });
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
        weekStart: '2026-11-16',
        status: 'published',
        version: 1,
        publishedVersion: 1,
        publishedAt: NOW,
        publishedBy: owner.id,
      })
      .returning();
    org.scheduleId = schedule!.id;
  });
  return org;
}

async function employee(org: Org, name: string): Promise<string> {
  return asOrg(org, async (tx) => {
    const [row] = await tx
      .insert(schema.employees)
      .values({
        orgId: org.id,
        name,
        email: `${name.split(' ')[0]!.toLowerCase()}@clinic.test`,
        notifyChannel: 'email',
        hourlyRateMinor: 40_000,
      })
      .returning();
    return row!.id;
  });
}

/** A shift starting `startIn` minutes from NOW, 8 hours long; published unless told not to. */
async function shift(
  org: Org,
  employeeId: string,
  startIn: number,
  options: { published?: boolean } = {},
): Promise<string> {
  const id = await asOrg(org, async (tx) => {
    const [row] = await tx
      .insert(schema.shifts)
      .values({
        orgId: org.id,
        scheduleId: org.scheduleId,
        locationId: org.locationId,
        employeeId,
        startsAt: minutes(startIn),
        endsAt: minutes(startIn + 8 * 60),
        status: 'assigned',
      })
      .returning();
    return row!.id;
  });
  if (options.published !== false) {
    org.published.push({ shiftId: id, employeeId });
    await publish(org);
  }
  return id;
}

/** Writes the latest publication snapshot: the shifts staff were told about. */
async function publish(org: Org): Promise<void> {
  await asOrg(org, async (tx) => {
    await tx.execute(sql`delete from schedule_publications where schedule_id = ${org.scheduleId}`);
    await tx.insert(schema.schedulePublications).values({
      orgId: org.id,
      scheduleId: org.scheduleId,
      version: 1,
      shifts: org.published.map((p) => ({
        ...p,
        date: '2026-11-16',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 0,
        jobRoleId: null,
      })),
      affectedEmployeeIds: org.published.map((p) => p.employeeId),
      publishedBy: org.ownerId,
    });
  });
}

async function events(org: Org, topic: string): Promise<OutboxEvent[]> {
  const rows = await asOrg(org, (tx) =>
    tx
      .select()
      .from(schema.outbox)
      .where(sql`org_id = ${org.id} and topic = ${topic}`),
  );
  return rows.map((row) => ({
    id: row.id,
    orgId: row.orgId!,
    topic: row.topic,
    payload: row.payload,
  }));
}

const shiftIdsOf = (list: OutboxEvent[]) =>
  list.map((event) => (event.payload as { shiftId: string }).shiftId).sort();

const punch = (org: Org, employeeId: string, at: Date) =>
  asOrg(org, (tx) =>
    tx.insert(schema.timeEntries).values({
      orgId: org.id,
      employeeId,
      locationId: org.locationId,
      clockInAt: at,
      inLatitude: 19.1197,
      inLongitude: 72.8468,
      inAccuracyM: 10,
      inDistanceM: 5,
      deviceTime: at,
    }),
  );

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;
});

afterAll(async () => {
  await database?.stop();
});

describe('the alert scan', () => {
  it('raises a reminder for a published shift in the next two hours, and nothing else', async () => {
    const org = await createOrg('Sunrise Clinic');
    const soon = await shift(org, await employee(org, 'Asha Mehta'), 90);
    await shift(org, await employee(org, 'Rohan Desai'), 180); // too far ahead
    await shift(org, await employee(org, 'Meera Iyer'), 60, { published: false }); // a draft

    await scanShiftAlerts(db, NOW);

    expect(shiftIdsOf(await events(org, 'shift.reminder'))).toEqual([soon]);
  });

  it('raises each alert once: three racing scans and a later one add nothing', async () => {
    const org = await createOrg('Lotus Clinic');
    const due = await shift(org, await employee(org, 'Asha Mehta'), 30);

    await Promise.all([
      scanShiftAlerts(db, NOW),
      scanShiftAlerts(db, NOW),
      scanShiftAlerts(db, NOW),
    ]);
    await scanShiftAlerts(db, minutes(5));

    expect(shiftIdsOf(await events(org, 'shift.reminder'))).toEqual([due]);
  });

  it('a shift reassigned since the last publish is not announced by a reminder', async () => {
    const org = await createOrg('Iris Clinic');
    const asha = await employee(org, 'Asha Mehta');
    const rohan = await employee(org, 'Rohan Desai');
    const shiftId = await shift(org, asha, 45);
    // The manager moved it to Rohan but has not published that yet.
    await asOrg(org, (tx) =>
      tx.execute(sql`update shifts set employee_id = ${rohan} where id = ${shiftId}`),
    );

    await scanShiftAlerts(db, NOW);

    expect(await events(org, 'shift.reminder')).toEqual([]);
  });

  it('raises a missed clock-in after the grace, unless a punch came in', async () => {
    const org = await createOrg('Rose Clinic');
    const late = await shift(org, await employee(org, 'Dev Kumar'), -10);
    const kiran = await employee(org, 'Kiran Rao');
    await shift(org, kiran, -10);
    await punch(org, kiran, minutes(-15)); // Kiran came in five minutes early
    // Neha is 3 minutes in, inside the org's default 5-minute grace: not yet.
    await shift(org, await employee(org, 'Neha Joshi'), -3);

    await scanShiftAlerts(db, NOW);

    expect(shiftIdsOf(await events(org, 'attendance.missed'))).toEqual([late]);
  });

  it("each org's alerts are written under that org", async () => {
    const a = await createOrg('Clinic A');
    const b = await createOrg('Clinic B');
    const inA = await shift(a, await employee(a, 'Asha Mehta'), 20);
    const inB = await shift(b, await employee(b, 'Asha Mehta'), 20);

    await scanShiftAlerts(db, NOW);

    expect(shiftIdsOf(await events(a, 'shift.reminder'))).toEqual([inA]);
    expect(shiftIdsOf(await events(b, 'shift.reminder'))).toEqual([inB]);
  });
});

describe('the alert handlers', () => {
  it('a reminder becomes one message to the person on the shift, once', async () => {
    const org = await createOrg('Sunrise Clinic');
    const asha = await employee(org, 'Asha Mehta');
    await shift(org, asha, 90);
    await scanShiftAlerts(db, NOW);
    const [event] = await events(org, 'shift.reminder');

    const result = await handleShiftReminder(db, event!, deps, NOW);
    const again = await handleShiftReminder(db, event!, deps, NOW);

    expect(result).toMatchObject({ notifications: 1, deliveries: 1 });
    expect(again).toMatchObject({ notifications: 0, deliveries: 0 });
    const [message] = await asOrg(org, (tx) =>
      tx
        .select({ subject: schema.notifications.subject, body: schema.notifications.body })
        .from(schema.notifications)
        .where(sql`employee_id = ${asha} and kind = 'shift.reminder'`),
    );
    expect(message!.subject).toBe('Shift in 1 hour 30 minutes · Mon 16 Nov 10:30–18:30');
    expect(message!.body).toContain(`http://app.test/o/${org.id}/shifts`);
  });

  it('a reminder for a shift cancelled since the scan sends nothing', async () => {
    const org = await createOrg('Lotus Clinic');
    const shiftId = await shift(org, await employee(org, 'Asha Mehta'), 60);
    await scanShiftAlerts(db, NOW);
    await asOrg(org, (tx) =>
      tx.execute(
        sql`update shifts set status = 'cancelled', employee_id = null where id = ${shiftId}`,
      ),
    );
    const [event] = await events(org, 'shift.reminder');

    expect(await handleShiftReminder(db, event!, deps, NOW)).toMatchObject({ notifications: 0 });
  });

  it('a missed clock-in tells the person, the owner and the managers of that location', async () => {
    const org = await createOrg('Rose Clinic');
    const everywhere = await newUser('Anil Manager');
    const elsewhere = await newUser('Bina Manager');
    await asOrg(org, async (tx) => {
      await tx.insert(schema.memberships).values([
        { orgId: org.id, userId: everywhere.id, role: 'manager' },
        { orgId: org.id, userId: elsewhere.id, role: 'manager' },
      ]);
      const [bandra] = await tx
        .insert(schema.locations)
        .values({
          orgId: org.id,
          name: 'Bandra',
          latitude: 19.06,
          longitude: 72.83,
          radiusM: 100,
          timezone: 'Asia/Kolkata',
        })
        .returning();
      // Bina looks after Bandra only.
      await tx
        .insert(schema.membershipLocations)
        .values({ orgId: org.id, userId: elsewhere.id, locationId: bandra!.id });
    });
    const dev = await employee(org, 'Dev Kumar');
    await shift(org, dev, -10);
    await scanShiftAlerts(db, NOW);
    const [event] = await events(org, 'attendance.missed');

    const result = await handleMissedClockIn(db, event!, deps, NOW);
    const again = await handleMissedClockIn(db, event!, deps, NOW);

    expect(result).toMatchObject({ notifications: 3, deliveries: 3 });
    expect(again).toMatchObject({ notifications: 0 });
    const sent = await asOrg(org, (tx) =>
      tx
        .select({
          employeeId: schema.notifications.employeeId,
          email: schema.notifications.recipientEmail,
          subject: schema.notifications.subject,
        })
        .from(schema.notifications)
        .where(sql`outbox_id = ${event!.id}`),
    );
    expect(sent.filter((n) => n.employeeId === dev)).toHaveLength(1);
    const managers = sent.filter((n) => n.email).map((n) => n.email);
    expect(managers).toContain(everywhere.email);
    expect(managers).not.toContain(elsewhere.email);
    expect(managers).toHaveLength(2); // Anil and the owner
    expect(sent.find((n) => n.email)!.subject).toBe('Dev Kumar has not clocked in · Andheri 08:50');
  });

  it('a punch that arrived after the scan cancels the alert', async () => {
    const org = await createOrg('Iris Clinic');
    const dev = await employee(org, 'Dev Kumar');
    await shift(org, dev, -10);
    await scanShiftAlerts(db, NOW);
    await punch(org, dev, minutes(-1));
    const [event] = await events(org, 'attendance.missed');

    expect(await handleMissedClockIn(db, event!, deps, NOW)).toMatchObject({ notifications: 0 });
  });
});
