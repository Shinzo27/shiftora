import { Injectable } from '@nestjs/common';
import { asc, eq, schema } from '@shiftora/db';
import type { MemberRole } from '@shiftora/domain';

import { RequestContext } from '../../database/request-context.js';

const { memberships, organizations } = schema;

export interface OrgRecord {
  id: string;
  name: string;
  createdAt: Date;
}

@Injectable()
export class OrgsRepository {
  constructor(private readonly context: RequestContext) {}

  /** RLS requires the transaction to already point at `id` (see OrgsService.create). */
  async create(id: string, name: string): Promise<OrgRecord> {
    const [org] = await this.context.tx.insert(organizations).values({ id, name }).returning();
    return org!;
  }

  /**
   * The tenant's clock-in policy. Read through RLS like everything else; a missing row means
   * the org is gone, which the tenancy interceptor would already have refused.
   */
  async geofencePolicy(): Promise<'flag' | 'reject'> {
    const [row] = await this.context.tx
      .select({ policy: organizations.geofencePolicy })
      .from(organizations)
      .where(eq(organizations.id, this.context.orgId))
      .limit(1);
    return row?.policy ?? 'flag';
  }

  /** Minutes of early/late slack that still count as on time (W3 D4). */
  async attendanceGraceMinutes(): Promise<number> {
    const [row] = await this.context.tx
      .select({ minutes: organizations.attendanceGraceMinutes })
      .from(organizations)
      .where(eq(organizations.id, this.context.orgId))
      .limit(1);
    return row?.minutes ?? 5;
  }

  async findById(id: string): Promise<OrgRecord | null> {
    const [org] = await this.context.tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return org ?? null;
  }

  /** The caller's orgs with their role in each. Works with no org selected (RLS policies
   *  members_read_own_orgs + users_read_own_memberships). */
  async listForUser(userId: string): Promise<(OrgRecord & { role: MemberRole })[]> {
    return this.context.tx
      .select({
        id: organizations.id,
        name: organizations.name,
        createdAt: organizations.createdAt,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(organizations.name));
  }
}
