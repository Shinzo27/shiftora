export type { ConnectionOptions, Database, DatabaseConnection } from './client.js';
export { createDatabaseConnection, pingDatabase } from './client.js';
export { runMigrations } from './migrate.js';
export { newId } from './schema/columns.js';
export * as schema from './schema/index.js';
export type { Transaction } from './tenant-context.js';
export { setOrgContext, setTenantContext } from './tenant-context.js';
// Query helpers re-exported so apps build queries with the same drizzle-orm instance
// as the schema (a second copy would make the column types incompatible).
export { and, asc, count, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
