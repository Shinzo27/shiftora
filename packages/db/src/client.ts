import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  close(): Promise<void>;
}

export interface ConnectionOptions {
  /** Max open connections in the pool. */
  maxConnections?: number;
  /** Called when an idle pooled connection errors (e.g. the server restarted). */
  onIdleError?: (error: Error) => void;
}

export function createDatabaseConnection(
  connectionString: string,
  options: ConnectionOptions = {},
): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: 5_000,
  });
  // Without a listener, an error on an idle connection would crash the process.
  pool.on('error', (error) => options.onIdleError?.(error));

  const db = drizzle({ client: pool, schema, casing: 'snake_case' });
  return { db, close: () => pool.end() };
}

/** Throws if the database can't run a trivial query. Used by the readiness check. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.execute(sql`select 1`);
}
