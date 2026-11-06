import { describe, expect, it } from 'vitest';

import { isValidTimeZone, normalizeTimeZone } from './timezone.js';

describe('isValidTimeZone', () => {
  it.each([
    'Asia/Kolkata',
    'Europe/London',
    'America/New_York',
    'America/Argentina/Buenos_Aires',
    'UTC',
  ])('accepts %s', (zone) => {
    expect(isValidTimeZone(zone)).toBe(true);
  });

  it.each(['', 'Mars/Phobos', '+05:30', 'GMT+5', 'asia kolkata', 'Asia/Kolkata;x'])(
    'rejects %j',
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});

describe('normalizeTimeZone', () => {
  it.each([
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Europe/London', 'Europe/London'],
  ])('%s → %s', (zone, expected) => {
    expect(normalizeTimeZone(zone)).toBe(expected);
    expect(isValidTimeZone(expected)).toBe(true);
  });
});
