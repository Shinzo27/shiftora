import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { relayOnce, type OutboxEvent } from './outbox-relay.js';

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;

beforeAll(async () => {
  database = await startTestDatabase();
  db = createDatabaseConnection(database.urlFor('app_user')).db;
  // The relay never creates users; these only exist so the org context is realistic.
  const owner = await db.execute<{ id: string }>(
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'relay@test.local', 'Relay', 'x') returning id`,
  );
  userId = owner.rows[0]!.id;
  orgId = crypto.randomUUID();
});

afterAll(async () => {
  await database?.stop();
});

beforeEach(async () => {
  // RLS means a bare delete removes nothing: clean up inside the org's own context. A test that
  // writes for another tenant removes its rows the same way, at the end of that test.
  await db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    await tx.execute(sql`delete from outbox where org_id = ${orgId}`);
  });
});

/** Writes an event the way a request handler would: inside the org's own context. */
async function writeEvent(topic: string, payload: unknown, at?: Date): Promise<string> {
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    await tx.insert(schema.outbox).values({
      id,
      orgId,
      topic,
      payload,
      ...(at ? { createdAt: at } : {}),
    });
  });
  return id;
}

async function publishedAt(id: string): Promise<Date | null> {
  const rows = await db.transaction(async (tx) => {
    await setTenantContext(tx, { userId, orgId });
    return tx.execute<{ published_at: Date | null }>(
      sql`select published_at from outbox where id = ${id}`,
    );
  });
  return rows.rows[0]?.published_at ?? null;
}

describe('the outbox relay', () => {
  it('queues every pending event and marks it published', async () => {
    const first = await writeEvent('schedule.published', { scheduleId: 'a' });
    const second = await writeEvent('schedule.published', { scheduleId: 'b' });
    const queued: OutboxEvent[] = [];

    const count = await relayOnce({ db, enqueue: (event) => void queued.push(event) });

    expect(count).toBe(2);
    expect(queued.map((event) => event.id).sort()).toEqual([first, second].sort());
    expect(queued.find((event) => event.id === first)).toMatchObject({
      orgId,
      topic: 'schedule.published',
      payload: { scheduleId: 'a' },
    });
    expect(await publishedAt(first)).not.toBeNull();
    expect(await publishedAt(second)).not.toBeNull();
  });

  it('leaves nothing to claim on the next tick', async () => {
    await writeEvent('schedule.published', { scheduleId: 'a' });
    const queued: OutboxEvent[] = [];

    await relayOnce({ db, enqueue: (event) => void queued.push(event) });
    const again = await relayOnce({ db, enqueue: (event) => void queued.push(event) });

    expect(again).toBe(0);
    expect(queued).toHaveLength(1);
  });

  it('claims the oldest first, and no more than the batch', async () => {
    const older = await writeEvent('schedule.published', {}, new Date('2026-11-01T09:00:00Z'));
    const newer = await writeEvent('schedule.published', {}, new Date('2026-11-02T09:00:00Z'));
    const queued: OutboxEvent[] = [];

    await relayOnce({ db, enqueue: (event) => void queued.push(event), batch: 1 });

    expect(queued.map((event) => event.id)).toEqual([older]);
    expect(await publishedAt(newer)).toBeNull();
  });

  it('keeps the event pending when the queue refuses it', async () => {
    const id = await writeEvent('schedule.published', { scheduleId: 'a' });

    await expect(
      relayOnce({
        db,
        enqueue: () => {
          throw new Error('redis is down');
        },
      }),
    ).rejects.toThrow('redis is down');

    // Rolled back as one transaction: the row is still waiting, so the event is late, not lost.
    expect(await publishedAt(id)).toBeNull();
  });

  it('re-queues a rolled-back claim under the same job id', async () => {
    const id = await writeEvent('schedule.published', {});
    const attempts: string[] = [];

    await relayOnce({
      db,
      enqueue: (event) => {
        attempts.push(event.id);
        throw new Error('crash after enqueue');
      },
    }).catch(() => undefined);
    await relayOnce({ db, enqueue: (event) => void attempts.push(event.id) });

    // Both attempts carried the outbox id, which is the BullMQ jobId — one job, not two.
    expect(attempts).toEqual([id, id]);
  });

  it('does not let two relays claim the same event', async () => {
    const ids = await Promise.all([
      writeEvent('schedule.published', {}),
      writeEvent('schedule.published', {}),
      writeEvent('schedule.published', {}),
    ]);
    const claimed: string[] = [];

    // Two workers, one event each, at the same moment: SKIP LOCKED hands out different rows.
    await Promise.all([
      relayOnce({ db, enqueue: (event) => void claimed.push(event.id), batch: 1 }),
      relayOnce({ db, enqueue: (event) => void claimed.push(event.id), batch: 1 }),
      relayOnce({ db, enqueue: (event) => void claimed.push(event.id), batch: 1 }),
    ]);

    expect(claimed).toHaveLength(3);
    expect(new Set(claimed).size).toBe(3);
    expect([...claimed].sort()).toEqual([...ids].sort());
  });

  it('still keeps tenants apart without the relay flag', async () => {
    const otherOrg = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await setTenantContext(tx, { userId, orgId: otherOrg });
      await tx.insert(schema.outbox).values({
        orgId: otherOrg,
        topic: 'schedule.published',
        payload: {},
      });
    });
    await writeEvent('schedule.published', {});

    // A normal app request sees only its own tenant's events; the relay's flag is what widens it.
    const visible = await db.transaction(async (tx) => {
      await setTenantContext(tx, { userId, orgId });
      return tx.execute<{ count: string }>(sql`select count(*) from outbox`);
    });
    expect(visible.rows[0]?.count).toBe('1');

    // Leave the row out of the next test's pending set.
    await db.transaction(async (tx) => {
      await setTenantContext(tx, { userId, orgId: otherOrg });
      await tx.execute(sql`delete from outbox where org_id = ${otherOrg}`);
    });
  });
});
