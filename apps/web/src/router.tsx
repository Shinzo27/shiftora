import { useQuery } from '@tanstack/react-query';
import { lazy } from 'react';
import { createBrowserRouter, Navigate, Outlet, useParams } from 'react-router';

import { LogoMark } from '@/components/logo';
import { Spinner } from '@/components/ui/spinner';
import { orgsApi } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * Pages are loaded per route (`lazy`): the board's drag-and-drop, Motion and the tables are
 * only downloaded by the people who open those screens. Login ships first; the rest follows —
 * which matters most on the phones this app is built for.
 */
const AuthPage = lazy(async () => ({ default: (await import('@/pages/auth-page')).AuthPage }));
const OrgsPage = lazy(async () => ({ default: (await import('@/pages/orgs-page')).OrgsPage }));
const ForgotPasswordPage = lazy(async () => ({
  default: (await import('@/pages/account-pages')).ForgotPasswordPage,
}));
const ResetPasswordPage = lazy(async () => ({
  default: (await import('@/pages/account-pages')).ResetPasswordPage,
}));
const VerifyEmailPage = lazy(async () => ({
  default: (await import('@/pages/account-pages')).VerifyEmailPage,
}));
const OrgLayout = lazy(async () => ({ default: (await import('@/pages/org-layout')).OrgLayout }));
const EmployeeLayout = lazy(async () => ({
  default: (await import('@/pages/employee-layout')).EmployeeLayout,
}));
const SchedulePage = lazy(async () => ({
  default: (await import('@/pages/schedule-page')).SchedulePage,
}));
const LocationsPage = lazy(async () => ({
  default: (await import('@/pages/locations-page')).LocationsPage,
}));
const AttendancePage = lazy(async () => ({
  default: (await import('@/pages/attendance-page')).AttendancePage,
}));
const AuditPage = lazy(async () => ({
  default: (await import('@/pages/audit-page')).AuditPage,
}));
const PayrollPage = lazy(async () => ({
  default: (await import('@/pages/payroll-page')).PayrollPage,
}));
const MessagesPage = lazy(async () => ({
  default: (await import('@/pages/messages-page')).MessagesPage,
}));
const RequestsPage = lazy(async () => ({
  default: (await import('@/pages/requests-page')).RequestsPage,
}));
const EmployeesPage = lazy(async () => ({
  default: (await import('@/pages/employees-page')).EmployeesPage,
}));
const MyShiftsPage = lazy(async () => ({
  default: (await import('@/pages/my-shifts-page')).MyShiftsPage,
}));
const MyTimeOffPage = lazy(async () => ({
  default: (await import('@/pages/my-time-off-page')).MyTimeOffPage,
}));
const MyProfilePage = lazy(async () => ({
  default: (await import('@/pages/my-profile-page')).MyProfilePage,
}));
const ErrorPage = lazy(async () => ({ default: (await import('@/pages/error-page')).ErrorPage }));

/** Waits for the session check on page load, then lets logged-in users through. */
function RequireAuth() {
  const session = useSession();
  if (session.isPending) return <FullPageSpinner label="Signing you in" />;
  return session.data ? <Outlet /> : <Navigate to="/login" replace />;
}

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4" aria-busy="true">
      <LogoMark className="size-10" />
      <Spinner className="text-muted-foreground" aria-label={label} />
    </div>
  );
}

/**
 * `/o/:orgId` lands where that person works: staff on their own shifts, managers and owners on
 * the team. Read from the org itself rather than a shell, so nobody sees the wrong shell first.
 */
function OrgHome() {
  const { orgId = '' } = useParams();
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => orgsApi.current(orgId) });

  if (org.isPending) return <FullPageSpinner label="Opening your organisation" />;
  if (org.isError) return <Navigate to="/orgs" replace />;

  const staffOnly = org.data.role === 'employee' || org.data.role === 'kiosk';
  return <Navigate to={staffOnly ? 'shifts' : 'employees'} replace />;
}

export const router = createBrowserRouter([
  {
    // One error screen for every route below (a crash in a page, a bad loader…).
    errorElement: <ErrorPage />,
    children: [
      { path: '/login', element: <AuthPage mode="login" /> },
      { path: '/signup', element: <AuthPage mode="signup" /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/reset-password', element: <ResetPasswordPage /> },
      { path: '/verify-email', element: <VerifyEmailPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <Navigate to="/orgs" replace /> },
          { path: '/orgs', element: <OrgsPage /> },
          {
            // The org in the URL becomes the X-Org-Id header on every API call below it.
            path: '/o/:orgId',
            children: [
              { index: true, element: <OrgHome /> },
              {
                // Manager shell: sidebar, location switcher, the rota.
                element: <OrgLayout />,
                children: [
                  { path: 'schedule', element: <SchedulePage /> },
                  { path: 'timesheets', element: <AttendancePage /> },
                  { path: 'locations', element: <LocationsPage /> },
                  { path: 'employees', element: <EmployeesPage /> },
                  { path: 'messages', element: <MessagesPage /> },
                  { path: 'payroll', element: <PayrollPage /> },
                  { path: 'audit', element: <AuditPage /> },
                  { path: 'requests', element: <RequestsPage /> },
                ],
              },
              {
                // Staff shell: phone layout with a bottom tab bar.
                element: <EmployeeLayout />,
                children: [
                  { path: 'shifts', element: <MyShiftsPage /> },
                  { path: 'time-off', element: <MyTimeOffPage /> },
                  { path: 'profile', element: <MyProfilePage /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
