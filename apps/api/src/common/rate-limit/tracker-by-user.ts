import type { ExecutionContext } from '@nestjs/common';

/**
 * Rate-limits per person, not per network.
 *
 * A clinic puts every manager behind one office IP, so counting by address would let the first
 * busy one lock the others out — and in tests it would carry one run's counters into the next.
 * The authenticated member is the honest subject; anything unauthenticated falls back to the
 * address, which is what the login routes want.
 *
 * The parameter type is the throttler's own (`Record<string, any>`), not `FastifyRequest`, so this
 * can be handed straight to `ThrottlerModule` without a cast at the call site.
 */
export function trackerByUser(
  request: Record<string, unknown>,
  _context: ExecutionContext,
): string {
  const member = request['member'] as { userId?: string } | undefined;
  return member?.userId ?? (request['ip'] as string | undefined) ?? 'anonymous';
}
