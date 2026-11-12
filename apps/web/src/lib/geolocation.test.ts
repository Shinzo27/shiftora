import { describe, expect, it } from 'vitest';

import { geoFailureReason, geoMessage, isPoorAccuracy, POOR_ACCURACY_M } from './geolocation.js';

const ok = { hasGeolocation: true, secureContext: true };

describe('geoFailureReason', () => {
  it('is null for a successful lookup', () => {
    expect(geoFailureReason({ ...ok, code: null })).toBeNull();
  });

  it('names an insecure page before anything else, because the prompt never appears', () => {
    expect(geoFailureReason({ ...ok, secureContext: false, code: 1 })).toBe('insecure');
  });

  it('distinguishes a refusal from a device that cannot answer', () => {
    expect(geoFailureReason({ ...ok, code: 1 })).toBe('denied');
    expect(geoFailureReason({ ...ok, code: 2 })).toBe('unavailable');
    expect(geoFailureReason({ ...ok, code: 3 })).toBe('timeout');
  });

  it('treats an unknown code as unavailable rather than inventing a cause', () => {
    expect(geoFailureReason({ ...ok, code: 99 })).toBe('unavailable');
  });

  it('spots a browser with no geolocation at all', () => {
    expect(geoFailureReason({ hasGeolocation: false, secureContext: true, code: null })).toBe(
      'unsupported',
    );
  });
});

describe('geoMessage', () => {
  it('always says what to do next', () => {
    for (const message of [
      geoMessage('insecure'),
      geoMessage('denied'),
      geoMessage('unsupported'),
      geoMessage('timeout'),
      geoMessage('unavailable'),
    ]) {
      expect(message.length).toBeGreaterThan(40);
      expect(message).toMatch(/try again|allow|ask your manager|open the app/i);
    }
  });
});

describe('isPoorAccuracy', () => {
  it('trusts a tight fix and questions a loose one', () => {
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracyM: 8 })).toBe(false);
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracyM: POOR_ACCURACY_M })).toBe(false);
    expect(isPoorAccuracy({ latitude: 0, longitude: 0, accuracyM: POOR_ACCURACY_M + 1 })).toBe(
      true,
    );
  });
});
