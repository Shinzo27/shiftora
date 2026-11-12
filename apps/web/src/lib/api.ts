import type {
  AuthResponse,
  AuthUser,
  CreateEmployeeRequest,
  CreateLocationRequest,
  CreateOrgRequest,
  CreateScheduleRequest,
  CreateShiftRequest,
  Employee,
  JobRole,
  Location,
  LoginRequest,
  OrgSummary,
  Page,
  Schedule,
  Shift,
  ShiftWriteResult,
  SignupRequest,
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
