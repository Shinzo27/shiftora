import { describe, expect, it } from 'vitest';

import { assignableRoles, canAssignRole, type MemberRole } from './roles.js';

describe('canAssignRole', () => {
  it.each<[MemberRole, string[]]>([
    ['owner', ['owner', 'manager', 'employee']],
    ['manager', ['employee']],
    ['employee', []],
    ['kiosk', []],
  ])('%s can assign %j', (actor, allowed) => {
    expect(assignableRoles.filter((role) => canAssignRole(actor, role))).toEqual(allowed);
  });
});
