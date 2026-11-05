import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// argon2id (the library default) with OWASP's minimum: 19 MiB memory, 2 passes, 1 thread.
// About 20–40 ms per hash. Raise memoryCost later if login stays fast enough.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordHasher {
  // Hashed once, lazily. Verifying against it when an email doesn't exist makes
  // "unknown email" take as long as "wrong password", so timing doesn't reveal accounts.
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash: treat as a mismatch, never as a crash
    }
  }

  async verifyAgainstDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('timing-equaliser-not-a-real-password');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
