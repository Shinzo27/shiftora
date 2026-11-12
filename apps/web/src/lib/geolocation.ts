/**
 * Asking the phone where it is, in the shape the clock screen needs.
 *
 * `navigator.geolocation` reports failures through a code and a `PositionError`, and hides the
 * two most common real causes behind "position unavailable": the page is not a secure context
 * (a phone on `http://192.168.x.x` — the permission prompt never appears) and the device has no
 * location hardware at all. Those are separated here so the screen can tell someone what to do
 * instead of "something went wrong".
 */

export type GeoFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export class GeolocationError extends Error {
  constructor(readonly reason: GeoFailure) {
    super(geoMessage(reason));
    this.name = 'GeolocationError';
  }
}

export interface Fix {
  latitude: number;
  longitude: number;
  /** Horizontal accuracy in metres, as the device reports it. */
  accuracyM: number;
}

/** What a failed lookup means. Pure, so the mapping is testable without a browser. */
export function geoFailureReason(input: {
  hasGeolocation: boolean;
  secureContext: boolean;
  /** The W3C error code, or null when the lookup succeeded. */
  code: number | null;
}): GeoFailure | null {
  if (!input.hasGeolocation) return 'unsupported';
  // A page served over plain http on a LAN address is not a secure context, and the browser
  // refuses geolocation without ever prompting — the cause people misread as "denied".
  if (!input.secureContext) return 'insecure';
  if (input.code === null) return null;
  if (input.code === 1) return 'denied';
  if (input.code === 3) return 'timeout';
  return 'unavailable';
}

/** What to tell the person holding the phone: the cause, and the next thing to try. */
export function geoMessage(reason: GeoFailure): string {
  switch (reason) {
    case 'insecure':
      return 'Location needs a secure connection. Open the app over https (or localhost), not a plain http address.';
    case 'denied':
      return 'Location is blocked for this site. Allow location in your browser settings, then try again.';
    case 'unsupported':
      return 'This browser cannot share your location. Ask your manager to clock you in from the office.';
    case 'timeout':
      return 'Finding you took too long. Step outside or near a window, then try again.';
    case 'unavailable':
      return 'Your phone could not get a location fix. Move somewhere with a clearer view of the sky and try again.';
  }
}

/** A fix the app should not trust without asking: beyond this, the server flags the punch too. */
export const POOR_ACCURACY_M = 100;

export function isPoorAccuracy(fix: Fix): boolean {
  return fix.accuracyM > POOR_ACCURACY_M;
}

/**
 * One position, high accuracy, no cached answer — a punch is about *now*.
 *
 * Rejects with a `GeolocationError` whose `reason` is safe to switch on. Never resolves with a
 * stale fix: a five-minute-old position would let someone clock in from the car park.
 */
export function currentFix(options: { timeoutMs?: number } = {}): Promise<Fix> {
  const hasGeolocation = typeof navigator !== 'undefined' && 'geolocation' in navigator;
  const secureContext = typeof window !== 'undefined' && window.isSecureContext;

  const unsupported = geoFailureReason({ hasGeolocation, secureContext, code: null });
  if (unsupported) return Promise.reject(new GeolocationError(unsupported));

  return new Promise<Fix>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyM: position.coords.accuracy,
        }),
      (error) => {
        const reason = geoFailureReason({
          hasGeolocation,
          secureContext,
          code: error.code,
        });
        reject(new GeolocationError(reason ?? 'unavailable'));
      },
      { enableHighAccuracy: true, timeout: options.timeoutMs ?? 15_000, maximumAge: 0 },
    );
  });
}
