import { describe, expect, it } from 'vitest';

import {
  checkGeofence,
  deviceSkewFlag,
  haversineMeters,
  MAX_TRUSTED_ACCURACY_M,
} from './geofence.js';

/** The clinic: Andheri, Mumbai. */
const clinic = { latitude: 19.1197, longitude: 72.8468 };
/** ~110 m north of the clinic, on the same street. */
const nextStreet = { latitude: 19.1207, longitude: 72.8468 };
/** ~2.2 km away: the station. */
const station = { latitude: 19.1197, longitude: 72.869 };

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(clinic, clinic)).toBe(0);
  });

  it('measures a short local hop', () => {
    // 0.001° of latitude is ~111 m anywhere.
    expect(haversineMeters(clinic, nextStreet)).toBeGreaterThan(105);
    expect(haversineMeters(clinic, nextStreet)).toBeLessThan(115);
  });

  it('measures across the city', () => {
    expect(haversineMeters(clinic, station)).toBeGreaterThan(2_000);
    expect(haversineMeters(clinic, station)).toBeLessThan(2_400);
  });

  it('is symmetric', () => {
    expect(haversineMeters(clinic, station)).toBeCloseTo(haversineMeters(station, clinic), 6);
  });
});

describe('checkGeofence', () => {
  it('accepts a punch inside the radius, and still allows for the fix', () => {
    const result = checkGeofence({ from: clinic, to: clinic, radiusM: 120, accuracyM: 8 });
    expect(result).toMatchObject({ inside: true, distanceM: 0, allowedM: 128, flags: [] });
  });

  it('accepts a slightly-outside punch when the phone admits its own uncertainty', () => {
    // ~111 m away on a 50 m fence: allowed once ±70 m accuracy is taken into account.
    const result = checkGeofence({ from: clinic, to: nextStreet, radiusM: 50, accuracyM: 70 });
    expect(result.inside).toBe(true);
    expect(result.allowedM).toBe(120);
    expect(result.flags).toEqual([]);
  });

  it('refuses the same punch on a tighter phone', () => {
    const result = checkGeofence({ from: clinic, to: nextStreet, radiusM: 50, accuracyM: 5 });
    expect(result.inside).toBe(false);
    expect(result.flags).toContain('outside_geofence');
  });

  it('does not let a hopeless fix widen the fence', () => {
    // ±400 m accuracy must not turn a 50 m fence into a 450 m one: the station is still out.
    const result = checkGeofence({ from: clinic, to: station, radiusM: 50, accuracyM: 400 });
    expect(result.allowedM).toBe(50 + MAX_TRUSTED_ACCURACY_M);
    expect(result.inside).toBe(false);
    expect(result.flags).toEqual(['outside_geofence', 'low_accuracy']);
  });

  it('flags poor accuracy even inside the fence', () => {
    const result = checkGeofence({ from: clinic, to: clinic, radiusM: 120, accuracyM: 250 });
    expect(result.inside).toBe(true);
    expect(result.flags).toEqual(['low_accuracy']);
  });

  it('rounds the distance to whole metres for the record', () => {
    const result = checkGeofence({ from: clinic, to: station, radiusM: 120, accuracyM: 10 });
    expect(Number.isInteger(result.distanceM)).toBe(true);
    expect(result.distanceM).toBeGreaterThan(2_000);
  });

  it('treats a negative accuracy as zero rather than shrinking the fence', () => {
    const result = checkGeofence({ from: clinic, to: clinic, radiusM: 25, accuracyM: -50 });
    expect(result.allowedM).toBe(25);
    expect(result.inside).toBe(true);
  });
});

describe('deviceSkewFlag', () => {
  const server = new Date('2026-11-12T09:00:00.000Z');

  it('says nothing for a clock within five minutes', () => {
    expect(deviceSkewFlag(new Date('2026-11-12T09:03:00.000Z'), server)).toEqual([]);
  });

  it('flags a clock that is wrong in either direction', () => {
    expect(deviceSkewFlag(new Date('2026-11-12T09:07:00.000Z'), server)).toEqual(['device_skew']);
    expect(deviceSkewFlag(new Date('2026-11-12T08:52:00.000Z'), server)).toEqual(['device_skew']);
  });
});
