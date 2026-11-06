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
  forbidden: 'auth.forbidden',
  orgRequired: 'org.required',
  notMember: 'org.not_member',
  memberNotFound: 'org.member_not_found',
  lastOwner: 'org.last_owner',
  inviteInvalid: 'invite.invalid',
  inviteEmailMismatch: 'invite.email_mismatch',
  alreadyMember: 'invite.already_member',
  nameTaken: 'conflict.name_taken',
  locationNotFound: 'location.not_found',
  locationReadOnly: 'location.read_only',
  ownerUnrestricted: 'location.owner_unrestricted',
  departmentNotFound: 'department.not_found',
  jobRoleNotFound: 'job_role.not_found',
  duplicate: 'conflict.duplicate',
  employeeNotFound: 'employee.not_found',
  employeeArchived: 'employee.archived',
  timeOffNotFound: 'time_off.not_found',
  shiftTemplateNotFound: 'shift_template.not_found',
  scheduleNotFound: 'schedule.not_found',
  shiftNotFound: 'shift.not_found',
  /** The employee is already working at that time (also enforced by the database). */
  shiftOverlap: 'shift.overlap',
  /** Someone else changed the shift since this version was read. */
  shiftVersionConflict: 'shift.version_conflict',
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
