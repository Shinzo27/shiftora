import type { ExecutionContext } from '@nestjs/common';

/**
 * Who a rate limit is counting.
 *
 * The throttler's signature is `(request, context)` — in that order. Swapping them makes every
 * request 500 inside the guard, because the first argument is a plain request object.
 *
 * Limiting by account (`LoginThrottlerGuard`) and by session family (`RefreshThrottlerGuard`) is
 * done in guards rather than here on purpose: a throttler's own `getTracker` beats the guard's
 * override, so a tracker in module options silently replaced the refresh guard's per-login key
 * with an address key — and logged a whole clinic out on the eleventh page load.
 */

/** The authenticated member, so two managers on one office IP have two budgets. */
export function trackerByUser(
  request: Record<string, unknown>,
  _context: ExecutionContext,
): string {
  const member = request['member'] as { userId?: string } | undefined;
  return member?.userId ?? addressOf(request);
}

function addressOf(request: Record<string, unknown>): string {
  const ip = request['ip'];
  return typeof ip === 'string' && ip ? ip : 'anonymous';
}
