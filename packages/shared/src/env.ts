import { z } from 'zod';

/**
 * Optional environment values where **empty means unset**.
 *
 * `.env.example` ships optional keys empty on purpose (`WHATSAPP_APP_SECRET=`), and that is also
 * how a deployment says "this feature is off" (`docker compose` with an unset `${VAR}` passes an
 * empty string). Node's `--env-file` loads `KEY=` as `''`, not as absent — so a plain
 * `.optional().min(16)` treats the empty string as a value, refuses it for being too short, and a
 * fresh `cp .env.example .env` dies at boot with
 * `Too small: expected string to have >=16 characters → at WHATSAPP_APP_SECRET`, on a machine that
 * has done nothing wrong. These helpers make empty mean the same thing as absent.
 */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

/** An optional string: absent *or* empty both mean "not configured". */
export function envText(min = 1) {
  return z.preprocess(emptyToUndefined, z.string().min(min).optional());
}

/** An optional URL: absent or empty both mean "not configured". */
export function envUrl(protocol?: RegExp) {
  const url = protocol ? z.url({ protocol }) : z.url();
  return z.preprocess(emptyToUndefined, url.optional());
}

/**
 * An enum with a default, where empty falls back to the default rather than failing: an empty
 * `WHATSAPP_PROVIDER=` means `none`, which is what "I did not decide" should do anyway.
 */
export function envEnum<const T extends readonly [string, ...string[]]>(
  values: T,
  fallback: T[number],
) {
  return z.preprocess(emptyToUndefined, z.enum(values).default(fallback));
}
