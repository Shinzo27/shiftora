import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

// Same folder from src/ (tests) and dist/ (built CLI): packages/db/migrations
const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/** Applies pending migrations. Must run as app_owner, never as app_user. */
export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
