import { describe, expect, it } from 'vitest';

import { createLocationRequest, updateLocationRequest } from './locations.js';

const valid = { name: 'Andheri', latitude: 19.11, longitude: 72.87, timezone: 'Asia/Kolkata' };

describe('createLocationRequest', () => {
  it('defaults the geofence radius to 100 m', () => {
    expect(createLocationRequest.parse(valid).radiusM).toBe(100);
  });

  it('turns an empty address into null', () => {
    expect(createLocationRequest.parse({ ...valid, address: '  ' }).address).toBeNull();
  });

  it.each([
    ['unknown time zone', { timezone: 'Mars/Phobos' }, 'timezone'],
    ['UTC offset instead of a zone', { timezone: '+05:30' }, 'timezone'],
    ['latitude out of range', { latitude: 95 }, 'latitude'],
    ['radius too small', { radiusM: 5 }, 'radiusM'],
    ['fractional radius', { radiusM: 50.5 }, 'radiusM'],
  ])('rejects %s', (_label, override, field) => {
    const result = createLocationRequest.safeParse({ ...valid, ...override });
    expect(result.error?.issues.map((i) => i.path.join('.'))).toContain(field);
  });
});

describe('updateLocationRequest', () => {
  it('accepts a single field', () => {
    expect(updateLocationRequest.parse({ radiusM: 250 })).toEqual({ radiusM: 250 });
  });

  it('rejects an empty update', () => {
    expect(updateLocationRequest.safeParse({}).success).toBe(false);
  });
});
