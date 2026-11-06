// "Area/Location" names like Asia/Kolkata or America/Argentina/Buenos_Aires, or plain UTC.
// Rejects offsets such as "+05:30": a fixed offset can't follow daylight-saving changes.
const IANA_NAME = /^(?:UTC|[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+)$/;

// Legacy IANA names that browsers (ICU) still report, mapped to their current names.
// Both resolve to the same rules; storing one spelling keeps data consistent.
const LEGACY_ZONES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Ponape': 'Pacific/Pohnpei',
};

/** The current IANA name for a zone, e.g. "Asia/Calcutta" → "Asia/Kolkata". */
export function normalizeTimeZone(zone: string): string {
  return LEGACY_ZONES[zone] ?? zone;
}

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
