import { describe, expect, it } from 'vitest';

import { PasswordHasher } from '../password-hasher.js';

const hasher = new PasswordHasher();

describe('PasswordHasher', () => {
  it('produces argon2id hashes with the OWASP parameters', async () => {
    const hash = await hasher.hash('correct horse');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('same')).not.toBe(await hasher.hash('same'));
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('correct horse');
    expect(await hasher.verify(hash, 'correct horse')).toBe(true);
    expect(await hasher.verify(hash, 'Correct horse')).toBe(false);
  });

  it('treats a malformed hash as a mismatch', async () => {
    expect(await hasher.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('verifyAgainstDummy always returns false', async () => {
    expect(await hasher.verifyAgainstDummy('timing-equaliser-not-a-real-password')).toBe(false);
  });
});
