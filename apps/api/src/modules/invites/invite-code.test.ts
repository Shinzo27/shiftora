import { describe, expect, it } from 'vitest';

import { formatInviteCode, parseInviteCode } from './invite-code.js';

const ORG = '0193a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b';
const SECRET = 'A'.repeat(42) + '_';

describe('invite codes', () => {
  it('round-trips the org id', () => {
    expect(parseInviteCode(formatInviteCode(ORG, SECRET))).toEqual({ orgId: ORG });
  });

  it.each([
    ['no dot', `${ORG}${SECRET}`],
    ['bad org id', `not-a-uuid.${SECRET}`],
    ['short secret', `${ORG}.abc`],
    ['secret with invalid characters', `${ORG}.${'A'.repeat(42)}!`],
    ['empty', ''],
  ])('rejects %s', (_label, code) => {
    expect(parseInviteCode(code)).toBeNull();
  });
});
