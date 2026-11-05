import { z } from 'zod';

const orgIdSchema = z.uuid();
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/**
 * An invite code is "<org id>.<secret>". The org id is not secret: it tells the API which
 * org to point the transaction at, so the invite can be found *through* RLS (no bypass
 * role needed). The 256-bit secret is what makes the code unguessable. Only the SHA-256 of
 * the whole code is stored.
 */
export function formatInviteCode(orgId: string, secret: string): string {
  return `${orgId}.${secret}`;
}

export function parseInviteCode(code: string): { orgId: string } | null {
  const dot = code.indexOf('.');
  if (dot < 0) return null;
  const orgId = code.slice(0, dot);
  const secret = code.slice(dot + 1);
  if (!orgIdSchema.safeParse(orgId).success || !SECRET.test(secret)) return null;
  return { orgId };
}
