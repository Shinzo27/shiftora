/**
 * What a provider's delivery report (a webhook) does to a delivery row.
 *
 * Providers report `sent` → `delivered` → `read`, or `failed`, but not reliably in order and not
 * exactly once: Meta retries a webhook it thinks was missed, and a `read` can arrive before its
 * `delivered`. So the rules are monotonic — a report can move a delivery forward, never back —
 * and applying the same report twice changes nothing.
 */

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface DeliveryState {
  status: 'queued' | 'sent' | 'delivered' | 'failed' | 'skipped';
  deliveredAt: Date | null;
  readAt: Date | null;
}

export interface ProviderReport {
  status: ProviderStatus;
  /** When the provider says it happened. */
  at: Date;
  /** The provider's reason, for a failure. */
  error?: string;
}

export type StatusChange =
  | { kind: 'progress'; status: 'delivered'; deliveredAt: Date; readAt: Date | null }
  /** Accepted earlier, then the provider gave up: the message falls back down the ladder. */
  | { kind: 'failed'; reason: string };

/**
 * The change a report makes, or null when it makes none.
 *
 * - `sent` is ignored: the worker marks a delivery sent itself, when the provider accepts it.
 * - `delivered`/`read` move a queued or sent delivery to `delivered` and fill in the times that
 *   are still empty (a `read` implies a delivery, at the latest when it was read).
 * - `failed` counts only for a delivery that was accepted (`sent`): one that already reached the
 *   phone cannot un-arrive, and one the worker already failed has already fallen back.
 * - A `skipped` delivery was never sent, so nothing about it can be reported.
 */
export function applyProviderReport(
  current: DeliveryState,
  report: ProviderReport,
): StatusChange | null {
  if (current.status === 'skipped') return null;

  if (report.status === 'failed') {
    if (current.status !== 'sent') return null;
    return { kind: 'failed', reason: report.error ?? 'The provider could not deliver it' };
  }

  if (report.status === 'sent') return null;
  // A failure is final for this channel; a late "delivered" for it is noise.
  if (current.status === 'failed') return null;

  const deliveredAt = current.deliveredAt ?? report.at;
  const readAt = report.status === 'read' ? (current.readAt ?? report.at) : current.readAt;

  const unchanged =
    current.status === 'delivered' &&
    current.deliveredAt?.getTime() === deliveredAt.getTime() &&
    current.readAt?.getTime() === readAt?.getTime();
  if (unchanged) return null;

  return { kind: 'progress', status: 'delivered', deliveredAt, readAt };
}
