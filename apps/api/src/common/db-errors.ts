/**
 * If a database error (or the error it wraps) is a unique-constraint violation (Postgres
 * code 23505), returns the constraint's name; otherwise null. Drizzle wraps driver errors,
 * so the details may sit on `cause`.
 */
export function uniqueViolation(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const { code, constraint } = current as { code?: unknown; constraint?: unknown };
    if (code === '23505') return typeof constraint === 'string' ? constraint : '';
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(error: unknown): boolean {
  return uniqueViolation(error) !== null;
}

/**
 * Exclusion-constraint violation (23P01). The shifts table uses one to make double-booking
 * impossible: `EXCLUDE USING gist (employee_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`.
 */
export function isExclusionViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '23P01') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
