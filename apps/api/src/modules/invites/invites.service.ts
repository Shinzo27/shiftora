import { Inject, Injectable } from '@nestjs/common';
import { addSeconds, canAssignRole, type AssignableRole, type Clock } from '@shiftora/domain';
import {
  errorCodes,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type Invite,
  type OrgSummary,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { RequestContext } from '../../database/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { MembershipsRepository } from '../orgs/memberships.repository.js';
import { OrgsRepository } from '../orgs/orgs.repository.js';
import { toOrgSummary } from '../orgs/orgs.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { formatInviteCode, parseInviteCode } from './invite-code.js';
import { InvitesRepository, type InviteRecord } from './invites.repository.js';

const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

function toInvite(record: InviteRecord): Invite {
  return {
    id: record.id,
    email: record.email,
    role: record.role as AssignableRole, // invites are only ever created with assignable roles
    invitedBy: record.invitedBy,
    expiresAt: record.expiresAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

const invalidInvite = () =>
  new AppException(404, errorCodes.inviteInvalid, 'This invite is invalid, used or expired.');
const forbiddenRole = () =>
  new AppException(403, errorCodes.forbidden, 'Your role does not allow inviting with this role.');

@Injectable()
export class InvitesService {
  constructor(
    private readonly context: RequestContext,
    private readonly invites: InvitesRepository,
    private readonly memberships: MembershipsRepository,
    private readonly orgs: OrgsRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Creates an invite and writes the email to the outbox **in the same transaction**.
   *
   * The code still comes back in the response — a manager standing next to the person may want
   * to read it out — but the email is the normal path, and it is written here so an invite can
   * never exist without one on its way.
   */
  async create(input: CreateInviteRequest): Promise<CreateInviteResponse> {
    if (!canAssignRole(this.context.role!, input.role)) throw forbiddenRole();
    if (await this.memberships.findByEmail(input.email)) {
      throw new AppException(409, errorCodes.alreadyMember, 'This person is already a member.');
    }

    const now = this.clock.now();
    // Re-inviting replaces the previous invite: its code stops working.
    await this.invites.revokePendingForEmail(input.email, now);

    const code = formatInviteCode(this.context.orgId, randomToken());
    const invite = await this.invites.create({
      email: input.email,
      role: input.role,
      tokenHash: sha256Hex(code),
      expiresAt: addSeconds(now, INVITE_TTL_SECONDS),
    });
    await this.audit.record({
      action: 'invite.created',
      entity: 'invite',
      entityId: invite.id,
      after: { email: invite.email, role: invite.role },
    });
    await this.outbox.record('invite.created', {
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
      code,
      expiresInDays: INVITE_TTL_SECONDS / (24 * 60 * 60),
    });
    return { invite: toInvite(invite), code };
  }

  async listOpen(): Promise<Invite[]> {
    return (await this.invites.listOpen(this.clock.now())).map(toInvite);
  }

  async revoke(id: string): Promise<void> {
    const now = this.clock.now();
    const invite = await this.invites.findOpen(id, now);
    if (!invite) throw invalidInvite();
    if (!canAssignRole(this.context.role!, invite.role as AssignableRole)) throw forbiddenRole();

    await this.invites.revoke(id, now);
    await this.audit.record({ action: 'invite.revoked', entity: 'invite', entityId: id });
  }

  /**
   * Accepts an invite for the logged-in user. Runs on a @WithoutOrg route: the org comes
   * from the code, and the transaction only enters that org once the code parses.
   */
  async accept(code: string): Promise<OrgSummary> {
    const parsed = parseInviteCode(code);
    if (!parsed) throw invalidInvite();

    await this.context.enterOrg(parsed.orgId);
    const now = this.clock.now();
    const invite = await this.invites.findOpenByHashForUpdate(sha256Hex(code), now);
    if (!invite) throw invalidInvite();

    const user = await this.auth.me(this.context.userId);
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new AppException(
        403,
        errorCodes.inviteEmailMismatch,
        'This invite was sent to a different email address.',
      );
    }

    const existingRole = await this.memberships.findRole(this.context.tx, parsed.orgId, user.id);
    if (!existingRole) {
      await this.memberships.create(user.id, invite.role);
      await this.audit.record({
        action: 'membership.created',
        entity: 'membership',
        entityId: user.id,
        after: { role: invite.role, via: 'invite' },
      });
    }
    await this.invites.markAccepted(invite.id, user.id, now);
    await this.audit.record({ action: 'invite.accepted', entity: 'invite', entityId: invite.id });

    const org = await this.orgs.findById(parsed.orgId);
    return toOrgSummary(org!, existingRole ?? invite.role);
  }
}
