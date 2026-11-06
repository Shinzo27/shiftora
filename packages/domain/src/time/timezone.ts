// "Area/Location" names like Asia/Kolkata or America/Argentina/Buenos_Aires, or plain UTC.
// Rejects offsets such as "+05:30": a fixed offset can't follow daylight-saving changes.
const IANA_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

/** True if `zone` is an IANA time-zone name the runtime knows (and so can do DST maths for). */
export function isValidTimeZone(zone: string): boolean {
  if (!IANA_NAME.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
