import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, schema, sql } from '@shiftora/db';
import type { AssignableRole } from '@shiftora/domain';

import { RequestContext } from '../../database/request-context.js';

const { invites } = schema;
export type InviteRecord = typeof invites.$inferSelect;

/** Open = not accepted, not revoked, not expired. */
function isOpen(now: Date) {
  return and(isNull(invites.acceptedAt), isNull(invites.revokedAt), gt(invites.expiresAt, now));
}

@Injectable()
export class InvitesRepository {
  constructor(private readonly context: RequestContext) {}

  async create(values: {
    email: string;
    role: AssignableRole;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<InviteRecord> {
    const [invite] = await this.context.tx
      .insert(invites)
      .values({ ...values, orgId: this.context.orgId, invitedBy: this.context.userId })
      .returning();
    return invite!;
  }

  async listOpen(now: Date): Promise<InviteRecord[]> {
    return this.context.tx
      .select()
      .from(invites)
      .where(and(eq(invites.orgId, this.context.orgId), isOpen(now)))
      .orderBy(sql`${invites.createdAt} desc`);
  }

  async findOpen(id: string, now: Date): Promise<InviteRecord | null> {
    const [invite] = await this.context.tx
      .select()
      .from(invites)
      .where(and(eq(invites.orgId, this.context.orgId), eq(invites.id, id), isOpen(now)));
    return invite ?? null;
  }

  /**
   * Finds an open invite by code hash and locks it (FOR UPDATE) until the transaction ends,
   * so two people accepting the same code at once can't both succeed.
   */
  async findOpenByHashForUpdate(tokenHash: string, now: Date): Promise<InviteRecord | null> {
    const [invite] = await this.context.tx
      .select()
      .from(invites)
      .where(
        and(eq(invites.orgId, this.context.orgId), eq(invites.tokenHash, tokenHash), isOpen(now)),
      )
      .for('update');
    return invite ?? null;
  }

  /** Revokes any not-yet-used invite for this email (expired ones included). */
  async revokePendingForEmail(email: string, now: Date): Promise<void> {
    await this.context.tx
      .update(invites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invites.orgId, this.context.orgId),
          eq(invites.email, email),
          isNull(invites.acceptedAt),
          isNull(invites.revokedAt),
        ),
      );
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.context.tx
      .update(invites)
      .set({ revokedAt: now })
      .where(and(eq(invites.orgId, this.context.orgId), eq(invites.id, id)));
  }

  async markAccepted(id: string, userId: string, now: Date): Promise<void> {
    await this.context.tx
      .update(invites)
      .set({ acceptedAt: now, acceptedBy: userId })
      .where(and(eq(invites.orgId, this.context.orgId), eq(invites.id, id)));
  }
}
