import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, schema, type DatabaseConnection } from '@shiftora/db';

import { DATABASE } from '../../database/database.module.js';

const { oneTimeTokens } = schema;
export type OneTimeTokenRow = typeof oneTimeTokens.$inferSelect;
export type TokenPurpose = 'verify_email' | 'reset_password';

/**
 * One-time tokens: minted on signup or on a forgotten password, consumed exactly once.
 *
 * Platform-level (no org, no RLS) like `sessions`, and stored as a SHA-256 hash — the raw token
 * exists only in the email. Redemption is a conditional UPDATE, so two clicks on the same link
 * cannot both succeed: the second finds `used_at` already set.
 */
@Injectable()
export class OneTimeTokensRepository {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  async create(values: {
    userId: string;
    purpose: TokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.db.insert(oneTimeTokens).values(values);
  }

  /** The newest live token for a purpose, so an older link stops working when a new one is sent. */
  async findLive(
    userId: string,
    purpose: TokenPurpose,
    now: Date,
  ): Promise<OneTimeTokenRow | null> {
    const [row] = await this.database.db
      .select()
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.usedAt),
          gt(oneTimeTokens.expiresAt, now),
        ),
      )
      .orderBy(desc(oneTimeTokens.createdAt))
      .limit(1);
    return row ?? null;
  }

  async findByHash(tokenHash: string, purpose: TokenPurpose): Promise<OneTimeTokenRow | null> {
    const [row] = await this.database.db
      .select()
      .from(oneTimeTokens)
      .where(and(eq(oneTimeTokens.tokenHash, tokenHash), eq(oneTimeTokens.purpose, purpose)));
    return row ?? null;
  }

  /** Returns true only if this call consumed the token; a second call gets false. */
  async consume(id: string, now: Date): Promise<boolean> {
    const [row] = await this.database.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(and(eq(oneTimeTokens.id, id), isNull(oneTimeTokens.usedAt)))
      .returning({ id: oneTimeTokens.id });
    return Boolean(row);
  }

  /** Retires every live token of a purpose, so re-issuing invalidates the previous link. */
  async retire(userId: string, purpose: TokenPurpose, now: Date): Promise<void> {
    await this.database.db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(oneTimeTokens.userId, userId),
          eq(oneTimeTokens.purpose, purpose),
          isNull(oneTimeTokens.usedAt),
        ),
      );
  }
}
