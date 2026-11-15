import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, schema, type DatabaseConnection } from '@shiftora/db';

import { DATABASE } from '../../database/database.module.js';

const { sessions } = schema;

export interface NewSession {
  id: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export type RotateResult = { status: 'rotated'; userId: string } | { status: 'invalid' | 'reused' };

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  /** Starts a new login: the first session's id is also its family id. */
  async start(userId: string, session: NewSession): Promise<void> {
    await this.database.db.insert(sessions).values({ ...session, userId, familyId: session.id });
  }

  /**
   * Swaps the presented refresh token for a new one, atomically.
   *
   * The conditional UPDATE (only if not yet revoked) is what makes concurrent refreshes
   * safe: Postgres row-locks the session, so of N parallel requests exactly one matches;
   * the others then see it revoked. A revoked token being presented again means it was
   * copied (stolen or replayed), so the whole family (that login, on every device that
   * shares it) is revoked.
   */
  async rotate(tokenHash: string, now: Date, next: NewSession): Promise<RotateResult> {
    return this.database.db.transaction(async (tx) => {
      const [current] = await tx
        .update(sessions)
        .set({ revokedAt: now, replacedBy: next.id })
        .where(
          and(
            eq(sessions.tokenHash, tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .returning({ userId: sessions.userId, familyId: sessions.familyId });

      if (current) {
        await tx
          .insert(sessions)
          .values({ ...next, userId: current.userId, familyId: current.familyId });
        return { status: 'rotated', userId: current.userId };
      }

      const [previous] = await tx
        .select({ familyId: sessions.familyId, revokedAt: sessions.revokedAt })
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash));

      if (previous?.revokedAt) {
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.familyId, previous.familyId), isNull(sessions.revokedAt)));
        return { status: 'reused' };
      }
      return { status: 'invalid' }; // unknown or expired
    });
  }

  /**
   * Revokes every live session for a person. Used when a password is reset: whoever knew the old
   * password should not keep a token that proves they did.
   */
  async revokeAllForUser(userId: string, now: Date): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  /** Logout: revokes one session. No-op if it's unknown or already revoked. */
  async revoke(tokenHash: string, now: Date): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }
}
