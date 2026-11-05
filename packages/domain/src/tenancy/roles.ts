/** Roles a user can hold in an organisation (ARCHITECTURE.md §9). */
export const memberRoles = ['owner', 'manager', 'employee', 'kiosk'] as const;
export type MemberRole = (typeof memberRoles)[number];

/** Roles a person can be invited as or promoted to. Kiosks are devices, set up separately. */
export const assignableRoles = ['owner', 'manager', 'employee'] as const;
export type AssignableRole = (typeof assignableRoles)[number];

/**
 * Who may give whom which role:
 *  - owners can assign any person role (including making another owner)
 *  - managers can only bring in employees
 *  - employees and kiosks can't assign roles
 */
export function canAssignRole(actor: MemberRole, role: AssignableRole): boolean {
  if (actor === 'owner') return true;
  if (actor === 'manager') return role === 'employee';
  return false;
}
