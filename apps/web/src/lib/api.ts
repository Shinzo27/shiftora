import type {
  Attendance,
  AuthResponse,
  AuthUser,
  ClaimOpenShiftResult,
  ClockInRequest,
  ClockOutRequest,
  ClockResult,
  CreateEmployeeRequest,
  CreateLocationRequest,
  CreateOrgRequest,
  CreatePayPeriod,
  CreateScheduleRequest,
  CreateShiftRequest,
  DeadLetter,
  DecideShiftRequest,
  Employee,
  JobRole,
  Location,
  LoginRequest,
  Me,
  MessageUsage,
  MyShifts,
  MyTimeEntries,
  NewShiftRequest,
  OpenShift,
  OrgSummary,
  Page,
  PayPeriodView,
  PublishPreview,
  PublishResult,
  RecentMessage,
  ReplayResult,
  Schedule,
  ScheduleConflicts,
  Shift,
  ShiftCandidates,
  ShiftRequestView,
  ShiftWriteResult,
  SignupRequest,
  TimeEntryWithEdits,
  TimeOff,
  UpdateEmployeeRequest,
  UpdateLocationRequest,
  UpdateShiftRequest,
} from '@shiftora/shared';

import { ApiClient } from './api-client.js';

export const api = new ApiClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '/api/v1',
  ...('locks' in navigator
    ? {
        locks: {
          request: <T>(name: string, callback: () => Promise<T>) =>
            navigator.locks.request(name, callback) as Promise<T>,
        },
      }
    : {}),
});

export const authApi = {
  /** On page load: trade the refresh cookie for an access token, then load the user. */
  restore: async (): Promise<AuthUser | null> => {
    if (!(await api.refresh())) return null;
    return api.get<AuthUser>('/auth/me');
  },
  login: async (body: LoginRequest): Promise<AuthUser> => {
    const res = await api.post<AuthResponse>('/auth/login', { body });
    api.setAccessToken(res.accessToken);
    return res.user;
  },
  signup: async (body: SignupRequest): Promise<AuthUser> => {
    const res = await api.post<AuthResponse>('/auth/signup', { body });
    api.setAccessToken(res.accessToken);
    return res.user;
  },
  logout: async (): Promise<void> => {
    await api.post('/auth/logout');
    api.setAccessToken(null);
  },

  /** Redeems the link from the confirmation email. A bad link is a 400, not a crash. */
  verifyEmail: async (token: string): Promise<void> => {
    await api.post('/auth/verify-email', { body: { token } });
  },

  /** Always succeeds from the caller's point of view: the server will not say who exists. */
  forgotPassword: async (email: string): Promise<void> => {
    await api.post('/auth/password/forgot', { body: { email } });
  },

  resetPassword: async (token: string, password: string): Promise<void> => {
    await api.post('/auth/password/reset', { body: { token, password } });
  },
};

export const pushApi = {
  /** Null when the server has no VAPID keys: the app then says notifications are unavailable. */
  publicKey: async (): Promise<string | null> => {
    const res = await api.get<{ publicKey: string | null }>('/push/public-key');
    return res.publicKey;
  },
  subscribe: async (
    orgId: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> => {
    await api.post('/me/push-subscriptions', { orgId, body });
  },
  unsubscribe: async (
    orgId: string,
    body: { endpoint: string; keys: { p256dh: string; auth: string } },
  ): Promise<void> => {
    await api.delete('/me/push-subscriptions', { orgId, body });
  },
};

export const orgsApi = {
  list: () => api.get<OrgSummary[]>('/orgs'),
  create: (body: CreateOrgRequest) => api.post<OrgSummary>('/orgs', { body }),
  current: (orgId: string) => api.get<OrgSummary>('/org', { orgId }),
};

export const locationsApi = {
  list: (orgId: string) => api.get<Location[]>('/locations', { orgId }),
  create: (orgId: string, body: CreateLocationRequest) =>
    api.post<Location>('/locations', { orgId, body }),
  update: (orgId: string, id: string, body: UpdateLocationRequest) =>
    api.patch<Location>(`/locations/${id}`, { orgId, body }),
};

export const jobRolesApi = {
  list: (orgId: string) => api.get<JobRole[]>('/job-roles', { orgId }),
  create: (orgId: string, name: string) =>
    api.post<JobRole>('/job-roles', { orgId, body: { name } }),
};

export const employeesApi = {
  list: (orgId: string, params: { locationId?: string; cursor?: string; limit?: number }) => {
    const query = new URLSearchParams({ limit: String(params.limit ?? 25) });
    if (params.locationId) query.set('locationId', params.locationId);
    if (params.cursor) query.set('cursor', params.cursor);
    return api.get<Page<Employee>>(`/employees?${query.toString()}`, { orgId });
  },
  create: (orgId: string, body: CreateEmployeeRequest) =>
    api.post<Employee>('/employees', { orgId, body }),
  update: (orgId: string, id: string, body: UpdateEmployeeRequest) =>
    api.patch<Employee>(`/employees/${id}`, { orgId, body }),
};

export const schedulesApi = {
  /** One location's schedules; `weekStart` narrows it to a single week. */
  list: (orgId: string, params: { locationId: string; weekStart?: string }) => {
    const query = new URLSearchParams({ locationId: params.locationId });
    if (params.weekStart) query.set('weekStart', params.weekStart);
    return api.get<Schedule[]>(`/schedules?${query.toString()}`, { orgId });
  },
  create: (orgId: string, body: CreateScheduleRequest) =>
    api.post<Schedule>('/schedules', { orgId, body }),
  /** Every advisory on the week's shifts, in one request (badges on the board). */
  conflicts: (orgId: string, scheduleId: string) =>
    api.get<ScheduleConflicts>(`/schedules/${scheduleId}/conflicts`, { orgId }),
  /** What a publish would change and who it would tell — read-only. */
  publishPreview: (orgId: string, scheduleId: string) =>
    api.get<PublishPreview>(`/schedules/${scheduleId}/publish-preview`, { orgId }),
  publish: (orgId: string, scheduleId: string) =>
    api.post<PublishResult>(`/schedules/${scheduleId}/publish`, { orgId }),
};

export const shiftsApi = {
  list: (orgId: string, scheduleId: string) =>
    api.get<Shift[]>(`/shifts?scheduleId=${scheduleId}`, { orgId }),
  create: (orgId: string, body: CreateShiftRequest) =>
    api.post<ShiftWriteResult>('/shifts', { orgId, body }),
  update: (orgId: string, id: string, body: UpdateShiftRequest) =>
    api.patch<ShiftWriteResult>(`/shifts/${id}`, { orgId, body }),
  remove: (orgId: string, id: string) => api.delete<void>(`/shifts/${id}`, { orgId }),
};

/** Clocking in and out, and reading back the punches. */
export const attendanceApi = {
  /** `idempotencyKey` is generated per punch by the caller: a retry returns the same row. */
  clockIn: (orgId: string, body: ClockInRequest, idempotencyKey: string) =>
    api.post<ClockResult>('/clock-in', {
      orgId,
      body,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  clockOut: (orgId: string, body: ClockOutRequest = {}) =>
    api.post<ClockResult>('/clock-out', { orgId, body }),
  entries: (orgId: string, from: string, to: string) =>
    api.get<MyTimeEntries>(`/me/time-entries?from=${from}&to=${to}`, { orgId }),
  /** A manager's view of one location for a local-date range. */
  list: (orgId: string, locationId: string, from: string, to: string) =>
    api.get<Attendance>(`/attendance?locationId=${locationId}&from=${from}&to=${to}`, { orgId }),
  /** One punch with its corrections. */
  detail: (orgId: string, id: string) =>
    api.get<TimeEntryWithEdits>(`/time-entries/${id}`, { orgId }),
  /** Flagged punches nobody has answered yet, for this branch and range. */
  flags: (orgId: string, locationId: string, from: string, to: string) =>
    api.get<Attendance>(`/attendance/flags?locationId=${locationId}&from=${from}&to=${to}`, {
      orgId,
    }),
  /** Accept or dispute a flagged punch. A dispute needs a note. */
  review: (orgId: string, id: string, body: { decision: 'accepted' | 'disputed'; note?: string }) =>
    api.post<TimeEntryWithEdits>(`/time-entries/${id}/review`, { orgId, body }),
  /** Correct a punch; the reason is required and lands in the audit trail. */
  edit: (
    orgId: string,
    id: string,
    body: { clockInTime?: string; clockOutTime?: string | null; reason: string },
  ) => api.patch<TimeEntryWithEdits>(`/time-entries/${id}`, { orgId, body }),
};

/** Everything a signed-in person may ask about themselves, whatever their role. */
export const meApi = {
  get: (orgId: string) => api.get<Me>('/me', { orgId }),
  /** Shifts assigned to the caller between two local dates (inclusive). */
  shifts: (orgId: string, from: string, to: string) =>
    api.get<MyShifts>(`/me/shifts?from=${from}&to=${to}`, { orgId }),
  timeOff: (orgId: string) => api.get<TimeOff[]>('/me/time-off', { orgId }),
};

/**
 * Open shifts and swap/drop requests (W5). A claim carries its own `Idempotency-Key`: the phone
 * in a corridor is where requests get retried, and the server answers a retry with the first
 * answer instead of a second shift.
 */
export const openShiftsApi = {
  mine: (orgId: string) => api.get<OpenShift[]>('/me/open-shifts', { orgId }),
  claim: (orgId: string, id: string, idempotencyKey: string) =>
    api.post<ClaimOpenShiftResult>(`/me/open-shifts/${id}/claim`, {
      orgId,
      headers: { 'idempotency-key': idempotencyKey },
    }),
  candidates: (orgId: string, shiftId: string) =>
    api.get<ShiftCandidates>(`/shifts/${shiftId}/candidates`, { orgId }),
};

export const shiftRequestsApi = {
  /** Mine, in both directions: what I asked for, and what is waiting on my answer. */
  mine: (orgId: string) => api.get<ShiftRequestView[]>('/me/shift-requests', { orgId }),
  create: (orgId: string, body: NewShiftRequest) =>
    api.post<ShiftRequestView>('/me/shift-requests', { orgId, body }),
  accept: (orgId: string, id: string) =>
    api.post<ShiftRequestView>(`/me/shift-requests/${id}/accept`, { orgId }),
  decline: (orgId: string, id: string, note?: string) =>
    api.post<ShiftRequestView>(`/me/shift-requests/${id}/decline`, { orgId, body: { note } }),
  cancel: (orgId: string, id: string) =>
    api.post<ShiftRequestView>(`/me/shift-requests/${id}/cancel`, { orgId }),
  /** A manager's inbox: the queue waiting on a decision. */
  inbox: (orgId: string, scope: 'open' | 'all' = 'open') =>
    api.get<ShiftRequestView[]>(`/shift-requests?scope=${scope}`, { orgId }),
  approve: (orgId: string, id: string, body: DecideShiftRequest = {}) =>
    api.post<ShiftRequestView>(`/shift-requests/${id}/approve`, { orgId, body }),
  reject: (orgId: string, id: string, body: DecideShiftRequest = {}) =>
    api.post<ShiftRequestView>(`/shift-requests/${id}/reject`, { orgId, body }),
};

/** Owner-only: messages the queue gave up on, replaying them, and the paid-message quota. */
export const messagesApi = {
  deadLetters: (orgId: string) => api.get<DeadLetter[]>('/messages/dead-letters', { orgId }),
  replay: (orgId: string, id: string) =>
    api.post<ReplayResult>(`/messages/dead-letters/${id}/replay`, { orgId }),
  usage: (orgId: string) => api.get<MessageUsage>('/messages/usage', { orgId }),
  recent: (orgId: string) => api.get<RecentMessage[]>('/messages/recent', { orgId }),
};

/** Pay periods and payroll (W6): managers set periods up; owners approve, read and export. */
export const payrollApi = {
  periods: (orgId: string) => api.get<PayPeriodView[]>('/pay-periods', { orgId }),
  create: (orgId: string, body: CreatePayPeriod) =>
    api.post<PayPeriodView>('/pay-periods', { orgId, body }),
  remove: (orgId: string, id: string) => api.delete<void>(`/pay-periods/${id}`, { orgId }),
  approve: (orgId: string, id: string) =>
    api.post<PayPeriodView>(`/pay-periods/${id}/approve`, { orgId }),
  export: (orgId: string, id: string, query: string) =>
    api.download(`/pay-periods/${id}/export?${query}`, { orgId }),
};
