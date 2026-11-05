import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';

import { runMigrations } from '../migrate.js';

const rolesSql = fileURLToPath(
  new URL('../../../../infra/postgres/init/01-roles.sql', import.meta.url),
);

export interface TestDatabase {
  /** Connection string for a role: 'app_user' (what the app uses) or 'app_owner'. */
  urlFor(role: 'app_user' | 'app_owner'): string;
  stop(): Promise<void>;
}

/**
 * Starts a throwaway Postgres in Docker with the same image, roles and migrations as
 * local dev, so integration tests exercise the real setup. Call in beforeAll; ~5–10 s.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('shiftora')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  try {
    await admin.query(await readFile(rolesSql, 'utf8'));
  } finally {
    await admin.end();
  }

  // Local dev passwords from 01-roles.sql equal the role names.
  const urlFor = (role: 'app_user' | 'app_owner') =>
    `postgres://${role}:${role}@${container.getHost()}:${container.getPort()}/shiftora`;

  await runMigrations(urlFor('app_owner'));

  return {
    urlFor,
    stop: async () => {
      await container.stop();
    },
  };
}
