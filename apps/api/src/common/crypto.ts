import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as a 43-character base64url string (256 bits: unguessable). */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hex SHA-256. Tokens and codes are stored only as this, so a DB leak exposes none. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
