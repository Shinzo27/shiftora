/**
 * Attendance geography, as pure maths.
 *
 * Everything here is a function of numbers the caller already has: the API computes the
 * distance from the organisation's own copy of the location, and decides with the same function
 * the tests exercise. No time zone, no database, no clock.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** GPS accuracy beyond this is not used to widen the fence: a phone that says "±400 m" is lost. */
export const MAX_TRUSTED_ACCURACY_M = 100;

const EARTH_RADIUS_M = 6_371_008.8; // mean radius
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres (haversine).
 *
 * Chosen over a flat approximation because a clinic's fence is tens of metres: at that scale
 * the error of treating latitude/longitude as a plane is small but the formula costs nothing.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeofenceFlag = 'outside_geofence' | 'low_accuracy' | 'device_skew';

export interface GeofenceResult {
  /** Straight-line distance from the location, rounded to a metre. */
  distanceM: number;
  /** The radius actually applied: the fence plus the phone's own uncertainty. */
  allowedM: number;
  inside: boolean;
  flags: GeofenceFlag[];
}

/**
 * Decides whether a punch is inside the fence.
 *
 * The rule is `distance ≤ radius + min(accuracy, 100 m)`: a phone that knows it is ±30 m out
 * should not be judged on a 25 m fence with centimetre confidence, but letting a 400 m fix
 * widen the fence to 425 m would make the control meaningless.
 */
export function checkGeofence(input: {
  from: Coordinates;
  to: Coordinates;
  radiusM: number;
  accuracyM: number;
}): GeofenceResult {
  const distance = haversineMeters(input.from, input.to);
  const slack = Math.min(Math.max(input.accuracyM, 0), MAX_TRUSTED_ACCURACY_M);
  const allowedM = input.radiusM + slack;

  const flags: GeofenceFlag[] = [];
  if (distance > allowedM) flags.push('outside_geofence');
  if (input.accuracyM > MAX_TRUSTED_ACCURACY_M) flags.push('low_accuracy');

  return {
    distanceM: Math.round(distance),
    allowedM: Math.round(allowedM),
    inside: flags.indexOf('outside_geofence') === -1,
    flags,
  };
}

/** A device clock further than this from the server's is worth telling a manager about. */
export const MAX_DEVICE_SKEW_MS = 5 * 60 * 1000;

/** Clock skew is a warning, never a rejection: phones in a basement drift. */
export function deviceSkewFlag(deviceTime: Date, receivedAt: Date): GeofenceFlag[] {
  return Math.abs(deviceTime.getTime() - receivedAt.getTime()) > MAX_DEVICE_SKEW_MS
    ? ['device_skew']
    : [];
}
