import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/** The transaction object Drizzle passes to db.transaction(async (tx) => …). */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Sets who is calling (and optionally which org) for the rest of this transaction only.
 * RLS policies read these through current_user_id() / current_org_id().
 * `true` as set_config's 3rd argument = transaction-local: the values vanish at COMMIT or
 * ROLLBACK, so a pooled connection never carries them into the next request.
 */
export async function setTenantContext(
  tx: Transaction,
  context: { userId: string; orgId?: string | null },
): Promise<void> {
  await tx.execute(
    sql`select set_config('app.user_id', ${context.userId}, true), set_config('app.org_id', ${context.orgId ?? ''}, true)`,
  );
}

/** Switches the org within the current transaction (creating an org, accepting an invite). */
export async function setOrgContext(tx: Transaction, orgId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
}
