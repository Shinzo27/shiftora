import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { MemberRole } from '@shiftora/domain';
import type { FastifyRequest } from 'fastify';

import type { OrgMember } from './member.js';

export const ROLES = 'tenancy:roles';
export const WITHOUT_ORG = 'tenancy:withoutOrg';

/**
 * Restricts a route to members with one of these roles in the selected org.
 * Without it, any member of the org may call the route.
 */
export const Roles = (...roles: MemberRole[]) => SetMetadata(ROLES, roles);

/**
 * The route needs a logged-in user but no organisation (e.g. creating an org, listing my
 * orgs, accepting an invite). Every other authenticated route requires X-Org-Id.
 */
export const WithoutOrg = () => SetMetadata(WITHOUT_ORG, true);

/** Injects the caller's membership in the selected org. */
export const CurrentMember = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrgMember => {
    const member = context.switchToHttp().getRequest<FastifyRequest>().member;
    if (!member) throw new Error('@CurrentMember() used on a route without an organisation');
    return member;
  },
);
