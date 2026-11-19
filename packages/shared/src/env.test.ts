import { describe, expect, it } from 'vitest';

import { envEnum, envText, envUrl } from './env.js';

describe('env helpers', () => {
  it('treats an empty value as unset, which is what .env.example ships', () => {
    // The bug: `cp .env.example .env` leaves optional keys empty, and `.optional().min(16)`
    // rejected '' for being too short — a fresh checkout could not boot the API.
    expect(envText(16).parse('')).toBeUndefined();
    expect(envText(16).parse(undefined)).toBeUndefined();
    expect(envUrl().parse('')).toBeUndefined();
  });

  it('still keeps a real value, and still refuses a bad one', () => {
    expect(envText(16).parse('a-real-secret-of-length')).toBe('a-real-secret-of-length');
    expect(envText(16).safeParse('too-short').success).toBe(false);
    expect(envUrl(/^rediss?$/).parse('redis://localhost:6379')).toBe('redis://localhost:6379');
    expect(envUrl(/^rediss?$/).safeParse('http://localhost:6379').success).toBe(false);
  });

  it('falls back to the default for an empty enum, so an empty provider means none', () => {
    expect(envEnum(['none', 'fake'], 'none').parse('')).toBe('none');
    expect(envEnum(['none', 'fake'], 'none').parse(undefined)).toBe('none');
    expect(envEnum(['none', 'fake'], 'none').parse('fake')).toBe('fake');
    expect(envEnum(['none', 'fake'], 'none').safeParse('meta').success).toBe(false);
  });
});
