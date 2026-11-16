import { describe, expect, it } from 'vitest';

import {
  isPaidChannel,
  maskAddress,
  monthlyLimit,
  nextFallback,
  retryDelayMs,
  usageMonth,
} from './delivery.js';

describe('quota', () => {
  it('only WhatsApp and SMS cost money', () => {
    expect(['email', 'whatsapp', 'sms', 'push'].filter((c) => isPaidChannel(c as never))).toEqual([
      'whatsapp',
      'sms',
    ]);
  });

  it('pools 1,000 WhatsApp and 200 SMS per paid location', () => {
    expect(monthlyLimit('whatsapp', 1)).toBe(1_000);
    expect(monthlyLimit('whatsapp', 3)).toBe(3_000);
    expect(monthlyLimit('sms', 2)).toBe(400);
  });

  it('an org with no paid location gets no paid messages', () => {
    expect(monthlyLimit('whatsapp', 0)).toBe(0);
  });

  it('counts months on the Indian calendar, where billing happens', () => {
    // 31 Oct 19:00 UTC is already 1 Nov 00:30 in India.
    expect(usageMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    expect(usageMonth(new Date('2026-10-31T18:00:00Z'))).toBe('2026-10');
  });
});

describe('retryDelayMs', () => {
  const middle = () => 0.5; // jitter factor exactly 1

  it('doubles from 5 seconds', () => {
    expect([1, 2, 3, 4].map((n) => retryDelayMs(n, middle))).toEqual([
      5_000, 10_000, 20_000, 40_000,
    ]);
  });

  it('spreads retries ±50% so a provider outage does not end in a synchronised stampede', () => {
    expect(retryDelayMs(2, () => 0)).toBe(5_000);
    expect(retryDelayMs(2, () => 0.999_999)).toBeCloseTo(15_000, -1);
  });

  it('never waits more than 30 minutes', () => {
    expect(retryDelayMs(20, middle)).toBe(30 * 60_000);
  });
});

describe('nextFallback', () => {
  it('moves down the ladder past the channels already tried', () => {
    expect(nextFallback(['whatsapp', 'email', 'push'], ['whatsapp'])).toBe('email');
    expect(nextFallback(['whatsapp', 'email', 'push'], ['whatsapp', 'email'])).toBe('push');
  });

  it('is null at the bottom of the ladder', () => {
    expect(nextFallback(['email', 'push'], ['email', 'push'])).toBeNull();
  });

  it('never falls back to a channel that costs money', () => {
    // SMS after a failed WhatsApp is the org's decision, not something a failure buys.
    expect(nextFallback(['whatsapp', 'sms', 'email'], ['whatsapp'])).toBe('email');
  });
});

describe('maskAddress', () => {
  it('keeps the last three digits of a phone number', () => {
    expect(maskAddress('+919820000001')).toBe('…001');
  });

  it('keeps the first letter and the domain of an email', () => {
    expect(maskAddress('asha@sunriseclinic.test')).toBe('a•••@sunriseclinic.test');
  });

  it('passes null through', () => {
    expect(maskAddress(null)).toBeNull();
  });
});
