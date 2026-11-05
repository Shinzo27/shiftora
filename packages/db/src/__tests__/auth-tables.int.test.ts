import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabaseConnection, type DatabaseConnection } from '../client.js';
import { sessions, users } from '../schema/index.js';
import { startTestDatabase, type TestDatabase } from '../testing/index.js';

let database: TestDatabase;
let connection: DatabaseConnection;

beforeAll(async () => {
  database = await startTestDatabase();
  connection = createDatabaseConnection(database.urlFor('app_user'));
});

afterAll(async () => {
  await connection?.close();
  await database?.stop();
});

/** Postgres error code from a failed Drizzle query (the pg error is the cause). */
function pgCode(error: unknown): string | undefined {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as { code?: string }).code;
}

describe('0001_auth', () => {
  it('generates UUIDv7 ids in the app', async () => {
    const [user] = await connection.db
      .insert(users)
      .values({ email: 'v7@example.com', name: 'V', passwordHash: 'x' })
      .returning();

    expect(user?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('users.email is unique case-insensitively (citext)', async () => {
    await connection.db
      .insert(users)
      .values({ email: 'Asha@Example.com', name: 'Asha', passwordHash: 'x' });

    const duplicate = connection.db
      .insert(users)
      .values({ email: 'asha@example.COM', name: 'Other', passwordHash: 'x' });

    await expect(duplicate).rejects.toSatisfy((e) => pgCode(e) === '23505');
  });

  it('finds a user by email in any casing and keeps the original casing', async () => {
    const [found] = await connection.db
      .select()
      .from(users)
      .where(eq(users.email, 'ASHA@EXAMPLE.COM'));

    expect(found?.email).toBe('Asha@Example.com');
  });

  it('deleting a user deletes their sessions', async () => {
    const [user] = await connection.db
      .insert(users)
      .values({ email: 'gone@example.com', name: 'Gone', passwordHash: 'x' })
      .returning();
    const userId = user!.id;
    await connection.db.insert(sessions).values({
      userId,
      familyId: userId,
      tokenHash: 'hash-gone',
      expiresAt: new Date('2030-01-01T00:00:00Z'),
    });

    await connection.db.delete(users).where(eq(users.id, userId));

    const left = await connection.db.select().from(sessions).where(eq(sessions.userId, userId));
    expect(left).toEqual([]);
  });
});
