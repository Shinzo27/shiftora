import { toLocal } from '../time/zoned.js';
import type { Channel } from './routing.js';

/**
 * The rules a delivery follows after routing has picked its channel: what a paid message costs
 * against the org's monthly quota, how long to wait before a retry, and where to go when a
 * channel has given up for good. Pure, so the worker's behaviour can be tested without a queue.
 */

/** Channels the clinic pays for per message. Email and Web Push are effectively free. */
export const PAID_CHANNELS = ['whatsapp', 'sms'] as const;
export type PaidChannel = (typeof PAID_CHANNELS)[number];

export function isPaidChannel(channel: Channel): channel is PaidChannel {
  return channel === 'whatsapp' || channel === 'sms';
}

/** Messages per paid location per month, pooled across the org (PRD §4). */
export const MONTHLY_QUOTA_PER_LOCATION: Record<PaidChannel, number> = {
  whatsapp: 1_000,
  sms: 200,
};

export function monthlyLimit(channel: PaidChannel, paidLocations: number): number {
  return MONTHLY_QUOTA_PER_LOCATION[channel] * Math.max(0, paidLocations);
}

/**
 * Billing is in India (INR, GST), so a quota month is an Indian calendar month: a message at
 * 00:30 IST on the 1st belongs to the new month even though it is still the 31st in UTC.
 */
export const BILLING_TIME_ZONE = 'Asia/Kolkata';

/** The quota month an instant falls in, as "YYYY-MM". */
export function usageMonth(instant: Date): string {
  return toLocal(instant, BILLING_TIME_ZONE).date.slice(0, 7);
}

const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 30 * 60_000;

/**
 * How long to wait before retry number `attemptsMade` (1 = after the first failure).
 *
 * Exponential from 5 s, capped at 30 minutes, with ±50% jitter: when a provider has an outage,
 * every message that failed in the same second would otherwise retry in the same second too, and
 * the recovery would be met by a stampede. `random` is injected so tests can pin it.
 */
export function retryDelayMs(attemptsMade: number, random: () => number = Math.random): number {
  const exponential = BASE_DELAY_MS * 2 ** Math.max(0, attemptsMade - 1);
  const capped = Math.min(exponential, MAX_DELAY_MS);
  // Jitter only below the cap: the cap is a promise ("never longer than 30 minutes").
  return capped === MAX_DELAY_MS ? MAX_DELAY_MS : Math.round(capped * (0.5 + random()));
}

/**
 * The next channel for a message whose current channel failed for good (or ran out of quota).
 *
 * `chain` is the person's ladder from `routeChannels`; `tried` is every channel this message
 * already has a delivery on. Paid channels are never a fallback: buying a second paid message
 * because the first failed is the org's decision, not something a failure decides.
 */
export function nextFallback(chain: readonly Channel[], tried: readonly Channel[]): Channel | null {
  return chain.find((channel) => !tried.includes(channel) && !isPaidChannel(channel)) ?? null;
}

/**
 * An address as an operator may see it: enough to recognise ("…001", "a•••@clinic.in"), not
 * enough to copy. The dead-letter page lists failures, not a contact directory.
 */
export function maskAddress(address: string | null): string | null {
  if (!address) return null;
  const at = address.indexOf('@');
  if (at > 0) return `${address[0]}•••${address.slice(at)}`;
  return `…${address.slice(-3)}`;
}
