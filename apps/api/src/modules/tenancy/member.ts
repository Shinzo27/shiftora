import type { MemberRole } from '@shiftora/domain';

/** The caller as a member of the selected org, attached by TenancyInterceptor. */
export interface OrgMember {
  userId: string;
  orgId: string;
  role: MemberRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    member?: OrgMember;
  }
}
