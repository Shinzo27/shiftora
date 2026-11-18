import { sql, type Database } from '@shiftora/db';

/** How many months of audit partitions to keep ready beyond the current one. */
export const AUDIT_MONTHS_AHEAD = 3;

/**
 * Makes sure the audit log has a partition for this month and the next few (W7 D4, migration
 * 0026). Idempotent and safe to run from several workers at once (the function takes an advisory
 * lock); a row that arrives for a month without one lands in `audit_events_default` and is moved
 * into place the next time this runs. Returns how many partitions it created.
 */
export async function ensureAuditPartitions(db: Pick<Database, 'execute'>): Promise<number> {
  const result = await db.execute<{ created: number }>(
    sql`select ensure_audit_partitions(${AUDIT_MONTHS_AHEAD}) as created`,
  );
  return Number(result.rows[0]?.created ?? 0);
}
