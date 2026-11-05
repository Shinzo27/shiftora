/**
 * Adds an elapsed duration (not calendar time) to an instant. Use for expiries such as
 * "token valid for 900 seconds". For "same local time next day" use the calendar helpers,
 * since a local day can be 23 or 25 hours long across DST.
 */
export function addSeconds(instant: Date, seconds: number): Date {
  if (!Number.isFinite(seconds)) {
    throw new RangeError(`seconds must be finite, got ${seconds}`);
  }
  return new Date(instant.getTime() + seconds * 1000);
}
