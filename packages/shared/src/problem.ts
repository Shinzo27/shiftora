/** Stable, machine-readable error codes. Clients branch on these, never on messages. */
export const errorCodes = {
  validationFailed: 'validation_failed',
  notFound: 'not_found',
  rateLimited: 'rate_limited',
  internal: 'internal_error',
  unauthenticated: 'auth.unauthenticated',
  emailTaken: 'auth.email_taken',
  invalidCredentials: 'auth.invalid_credentials',
  invalidRefreshToken: 'auth.invalid_refresh_token',
} as const;

export type ErrorCode = (typeof errorCodes)[keyof typeof errorCodes] | (string & {});

export interface FieldError {
  /** Dot path of the invalid field, e.g. "email" or "shifts.0.startsAt". */
  path: string;
  message: string;
}

/** RFC 7807 "problem details" body, plus our stable `code`. */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  errors?: FieldError[];
}
