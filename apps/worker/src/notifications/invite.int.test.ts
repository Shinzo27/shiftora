import {
  createDatabaseConnection,
  schema,
  setTenantContext,
  sql,
  type Database,
} from '@shiftora/db';
import { startTestDatabase, type TestDatabase } from '@shiftora/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { handleInviteCreated } from './invite.js';

let database: TestDatabase;
let db: Database;
let orgId: string;
let userId: string;

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
    sql`insert into users (id, email, name, password_hash) values (${crypto.randomUUID()}, 'owner@test.local', 'Owner', 'x') returning id`,
  );
  userId = owner.rows[0]!.id;
  orgId = crypto.randomUUID();
  await asOrg(async (tx) => {
    await tx.insert(schema.organizations).values({ id: orgId, name: 'Sunrise Clinic' });
  });
});

afterAll(async () => {
  await database?.stop();
});

const event = (code = 'SC-abc123') => ({
  id: crypto.randomUUID(),
  orgId,
  topic: 'invite.created',
  payload: {
    inviteId: crypto.randomUUID(),
    email: 'rohan@example.test',
    role: 'manager',
    code,
    expiresInDays: 7,
  },
});

describe('invite.created', () => {
  it('emails the invite address with a link that carries the code', async () => {
    const result = await handleInviteCreated(db, event(), 'http://localhost:5173');

    expect(result).toMatchObject({ notifications: 1, deliveries: 1 });

    const [notification] = await asOrg((tx) =>
      tx
        .select({
          recipient: schema.notifications.recipientEmail,
          employee: schema.notifications.employeeId,
          subject: schema.notifications.subject,
          body: schema.notifications.body,
        })
        .from(schema.notifications),
    );
    // Addressed to an email, because the person has no account or staff row yet.
    expect(notification).toMatchObject({ recipient: 'rohan@example.test', employee: null });
    expect(notification?.subject).toBe('You are invited to Sunrise Clinic on Shiftora');
    expect(notification?.body).toContain('http://localhost:5173/invite/SC-abc123');

    const [delivery] = await asOrg((tx) =>
      tx
        .select({
          channel: schema.deliveries.channel,
          address: schema.deliveries.address,
          status: schema.deliveries.status,
        })
        .from(schema.deliveries),
    );
    expect(delivery).toEqual({
      channel: 'email',
      address: 'rohan@example.test',
      status: 'queued',
    });
  });

  it('does not email twice when the event is replayed', async () => {
    const first = event('SC-replay');
    await handleInviteCreated(db, first, 'http://localhost:5173');
    const replay = await handleInviteCreated(db, first, 'http://localhost:5173');

    expect(replay).toMatchObject({ notifications: 0, deliveries: 0, deliveryIds: [] });
  });

  it('ignores an event with no code, rather than sending a broken link', async () => {
    const result = await handleInviteCreated(
      db,
      { ...event(), payload: { email: 'x@example.test', role: 'employee' } },
      'http://localhost:5173',
    );
    expect(result).toMatchObject({ notifications: 0, deliveries: 0 });
  });
});
