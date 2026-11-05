import { Injectable } from '@nestjs/common';
import type { AssignableRole } from '@shiftora/domain';
import { errorCodes, type Member } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { MembershipsRepository, type MemberRecord } from './memberships.repository.js';

function toMember(record: MemberRecord): Member {
  return { ...record, joinedAt: record.joinedAt.toISOString() };
}

const notFound = () =>
  new AppException(404, errorCodes.memberNotFound, 'No such member in this organisation.');
const lastOwner = () =>
  new AppException(409, errorCodes.lastOwner, 'An organisation needs at least one owner.');

@Injectable()
export class MembersService {
  constructor(
    private readonly context: RequestContext,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Member[]> {
    return (await this.memberships.list()).map(toMember);
  }

  /** Owner-only route. Re-checks ownership under lock, then guards the last owner. */
  async changeRole(userId: string, role: AssignableRole): Promise<Member> {
    const owners = await this.memberships.lockOwners();
    if (!owners.includes(this.context.userId)) {
      // They were an owner when the request started, but a concurrent request demoted them.
      throw new AppException(403, errorCodes.forbidden, 'Only owners can change roles.');
    }
    const target = await this.memberships.find(userId);
    if (!target) throw notFound();
    if (target.role === role) return toMember(target);
    if (target.role === 'owner' && owners.length === 1) throw lastOwner();

    await this.memberships.updateRole(userId, role);
    await this.audit.record({
      action: 'membership.role_changed',
      entity: 'membership',
      entityId: userId,
      before: { role: target.role },
      after: { role },
    });
    return toMember({ ...target, role });
  }

  /**
   * Owners can remove anyone, managers can remove employees, and anyone can leave.
   * Never removes the last owner.
   */
  async remove(userId: string): Promise<void> {
    const owners = await this.memberships.lockOwners();
    const target = await this.memberships.find(userId);
    if (!target) throw notFound();

    const actorRole = this.context.role;
    const allowed =
      userId === this.context.userId ||
      actorRole === 'owner' ||
      (actorRole === 'manager' && target.role === 'employee');
    if (!allowed) {
      throw new AppException(
        403,
        errorCodes.forbidden,
        'Your role does not allow removing this member.',
      );
    }
    if (target.role === 'owner' && owners.length === 1) throw lastOwner();

    await this.memberships.remove(userId);
    await this.audit.record({
      action: 'membership.removed',
      entity: 'membership',
      entityId: userId,
      before: { role: target.role, email: target.email },
    });
  }
}
