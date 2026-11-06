/**
 * True if a database error (or the error it wraps) is a unique-constraint violation
 * (Postgres code 23505). Drizzle wraps driver errors, so the code may sit on `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
