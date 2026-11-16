/**
 * What kind of failure a provider reported. Only the adapter can tell an invalid number from a
 * provider having a bad minute, so adapters throw `SendError` and dispatch decides from `kind`:
 *
 * - `permanent`    — the same request can never succeed (invalid number, opted out, template
 *                    rejected): no retry; the message falls back down the ladder now.
 * - `transient`    — worth trying again later (timeout, 5xx): retry with backoff.
 * - `rate_limited` — the provider asked us to slow down (HTTP 429): pause the queue for
 *                    `retryAfterMs` without spending one of the message's attempts.
 *
 * Anything that is not a `SendError` (a socket error, a bug) is treated as transient: retrying a
 * message that might have worked is cheaper than dropping one that would have.
 */
export type SendFailureKind = 'permanent' | 'transient' | 'rate_limited';

export class SendError extends Error {
  constructor(
    message: string,
    readonly kind: SendFailureKind,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

export interface ClassifiedFailure {
  kind: SendFailureKind;
  reason: string;
  retryAfterMs?: number;
}

export function classifySendError(error: unknown): ClassifiedFailure {
  if (error instanceof SendError) {
    return {
      kind: error.kind,
      reason: error.message,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }
  return { kind: 'transient', reason: error instanceof Error ? error.message : String(error) };
}
