import { assignableRoles, memberRoles } from '@shiftora/domain';
import { z } from 'zod';

import { email } from './auth.js';

export const memberRole = z.enum(memberRoles);
export const assignableRole = z.enum(assignableRoles);

/** Header that selects the organisation a request acts on. */
export const ORG_HEADER = 'x-org-id';

export const createOrgRequest = z.object({
  name: z.string().trim().min(1, 'Required').max(100, 'At most 100 characters'),
});
export type CreateOrgRequest = z.output<typeof createOrgRequest>;

/** An organisation as seen by one member: includes that member's role. */
export const orgSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  role: memberRole,
  createdAt: z.iso.datetime(),
});
export type OrgSummary = z.output<typeof orgSummary>;

export const member = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: memberRole,
  joinedAt: z.iso.datetime(),
});
export type Member = z.output<typeof member>;

export const updateMemberRequest = z.object({ role: assignableRole });
export type UpdateMemberRequest = z.output<typeof updateMemberRequest>;

export const createInviteRequest = z.object({ email, role: assignableRole });
export type CreateInviteRequest = z.output<typeof createInviteRequest>;

export const invite = z.object({
  id: z.uuid(),
  email: z.string(),
  role: assignableRole,
  invitedBy: z.uuid(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type Invite = z.output<typeof invite>;

/** The code is shown once; only its hash is stored. Until email arrives (week 4) it's shared by hand. */
export const createInviteResponse = z.object({ invite, code: z.string() });
export type CreateInviteResponse = z.output<typeof createInviteResponse>;

export const acceptInviteRequest = z.object({ code: z.string().trim().min(1).max(200) });
export type AcceptInviteRequest = z.output<typeof acceptInviteRequest>;
