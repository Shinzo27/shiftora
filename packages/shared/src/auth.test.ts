import { describe, expect, it } from 'vitest';

import { loginRequest, signupRequest } from './auth.js';

const valid = { name: 'Asha Patel', email: 'asha@example.com', password: 'correct horse' };

describe('signupRequest', () => {
  it('accepts a valid signup and trims name and email', () => {
    expect(
      signupRequest.parse({ ...valid, name: '  Asha Patel ', email: ' Asha@Example.com ' }),
    ).toEqual({ name: 'Asha Patel', email: 'Asha@Example.com', password: 'correct horse' });
  });

  it('does not trim passwords', () => {
    expect(signupRequest.parse({ ...valid, password: ' 12345678 ' }).password).toBe(' 12345678 ');
  });

  it.each([
    ['too short password', { password: '1234567' }, 'password'],
    ['too long password', { password: 'x'.repeat(129) }, 'password'],
    ['invalid email', { email: 'not-an-email' }, 'email'],
    ['blank name', { name: '   ' }, 'name'],
    ['too long name', { name: 'x'.repeat(101) }, 'name'],
  ])('rejects %s', (_label, override, field) => {
    const result = signupRequest.safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(field);
  });

  it('accepts the length boundaries (8 and 128 characters)', () => {
    expect(signupRequest.safeParse({ ...valid, password: 'x'.repeat(8) }).success).toBe(true);
    expect(signupRequest.safeParse({ ...valid, password: 'x'.repeat(128) }).success).toBe(true);
  });
});

describe('loginRequest', () => {
  it('accepts a short existing password (signup policy is not re-applied)', () => {
    expect(loginRequest.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(true);
  });

  it('rejects an empty password', () => {
    expect(loginRequest.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
