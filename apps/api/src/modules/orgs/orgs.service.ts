import { Injectable } from '@nestjs/common';
import { newId } from '@shiftora/db';
import type { MemberRole } from '@shiftora/domain';
import type { OrgSummary } from '@shiftora/shared';

import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { MembershipsRepository } from './memberships.repository.js';
import { OrgsRepository, type OrgRecord } from './orgs.repository.js';

export function toOrgSummary(org: OrgRecord, role: MemberRole): OrgSummary {
  return { id: org.id, name: org.name, role, createdAt: org.createdAt.toISOString() };
}

@Injectable()
export class OrgsService {
  constructor(
    private readonly context: RequestContext,
    private readonly orgs: OrgsRepository,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditService,
  ) {}

  /** Creates an org with the caller as its first owner, in one transaction. */
  async create(name: string): Promise<OrgSummary> {
    const orgId = newId();
    // RLS only accepts rows for the org the transaction points at, so point it at the new
    // org first. Safe: nobody else can be acting on an org that doesn't exist yet.
    await this.context.enterOrg(orgId);
    const org = await this.orgs.create(orgId, name);
    await this.memberships.create(this.context.userId, 'owner');
    await this.audit.record({
      action: 'org.created',
      entity: 'organization',
      entityId: orgId,
      after: { name },
    });
    return toOrgSummary(org, 'owner');
  }

  async listMine(): Promise<OrgSummary[]> {
    const orgs = await this.orgs.listForUser(this.context.userId);
    return orgs.map((org) => toOrgSummary(org, org.role));
  }

  /** The selected org, as the caller sees it. Membership was checked by TenancyInterceptor. */
  async current(): Promise<OrgSummary> {
    const org = await this.orgs.findById(this.context.orgId);
    return toOrgSummary(org!, this.context.role!);
  }
}
