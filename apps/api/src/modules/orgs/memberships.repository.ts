import { Injectable } from '@nestjs/common';
import { and, asc, eq, schema, type Transaction } from '@shiftora/db';
import type { MemberRole } from '@shiftora/domain';

import { RequestContext } from '../../database/request-context.js';

const { memberships, users } = schema;

export interface MemberRecord {
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  joinedAt: Date;
}

/**
 * Every query filters by org_id explicitly, even though RLS also restricts rows. The
 * memberships table has two read policies, "rows of the current org" OR "your own
 * memberships anywhere", so without the filter a query would also return the caller's
 * memberships in OTHER orgs. RLS is the safety net; the filter states the intent.
 */
@Injectable()
export class MembershipsRepository {
  constructor(private readonly context: RequestContext) {}

  /** Used by TenancyInterceptor before the request context exists, hence the explicit tx. */
  async findRole(tx: Transaction, orgId: string, userId: string): Promise<MemberRole | null> {
    const [row] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
      .limit(1);
    return row?.role ?? null;
  }

  async create(userId: string, role: MemberRole): Promise<void> {
    await this.context.tx.insert(memberships).values({ orgId: this.context.orgId, userId, role });
  }

  /** Members with name and email (joined from users, the platform identity table). */
  async list(): Promise<MemberRecord[]> {
    return this.selectMembers()
      .where(eq(memberships.orgId, this.context.orgId))
      .orderBy(asc(memberships.createdAt));
  }

  async find(userId: string): Promise<MemberRecord | null> {
    const [row] = await this.selectMembers()
      .where(and(eq(memberships.orgId, this.context.orgId), eq(memberships.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<MemberRecord | null> {
    const [row] = await this.selectMembers()
      .where(and(eq(memberships.orgId, this.context.orgId), eq(users.email, email)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Locks the org's owner rows (SELECT … FOR UPDATE) until the transaction ends and returns
   * their user ids. Two concurrent "demote or remove an owner" requests then run one after
   * the other, so they can't both pass the last-owner check and leave the org ownerless.
   */
  async lockOwners(): Promise<string[]> {
    const rows = await this.context.tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, this.context.orgId), eq(memberships.role, 'owner')))
      .for('update');
    return rows.map((row) => row.userId);
  }

  async updateRole(userId: string, role: MemberRole): Promise<void> {
    await this.context.tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.orgId, this.context.orgId), eq(memberships.userId, userId)));
  }

  async remove(userId: string): Promise<void> {
    await this.context.tx
      .delete(memberships)
      .where(and(eq(memberships.orgId, this.context.orgId), eq(memberships.userId, userId)));
  }

  private selectMembers() {
    return this.context.tx
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .$dynamic();
  }
}
