import { createBrowserRouter, Navigate, Outlet } from 'react-router';

import { LogoMark } from '@/components/logo';
import { Spinner } from '@/components/ui/spinner';
import { useOrg } from '@/lib/org-context';
import { useSession } from '@/lib/session';
import { AuthPage } from '@/pages/auth-page';
import { EmployeesPage } from '@/pages/employees-page';
import { ErrorPage } from '@/pages/error-page';
import { LocationsPage } from '@/pages/locations-page';
import { OrgLayout } from '@/pages/org-layout';
import { OrgsPage } from '@/pages/orgs-page';

/** Waits for the session check on page load, then lets logged-in users through. */
function RequireAuth() {
  const session = useSession();
  if (session.isPending) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4" aria-busy="true">
        <LogoMark className="size-10" />
        <Spinner className="text-muted-foreground" aria-label="Signing you in" />
      </div>
    );
  }
  return session.data ? <Outlet /> : <Navigate to="/login" replace />;
}

/** /o/:orgId lands on employees for managers once a location exists, else on locations. */
function OrgHome() {
  const { role, locations } = useOrg();
  const managing = role === 'owner' || role === 'manager';
  return <Navigate to={managing && locations.length ? 'employees' : 'locations'} replace />;
}

export const router = createBrowserRouter([
  {
    // One error screen for every route below (a crash in a page, a bad loader…).
    errorElement: <ErrorPage />,
    children: [
      { path: '/login', element: <AuthPage mode="login" /> },
      { path: '/signup', element: <AuthPage mode="signup" /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/', element: <Navigate to="/orgs" replace /> },
          { path: '/orgs', element: <OrgsPage /> },
          {
            // The org in the URL becomes the X-Org-Id header on every API call below it.
            path: '/o/:orgId',
            element: <OrgLayout />,
            children: [
              { index: true, element: <OrgHome /> },
              { path: 'locations', element: <LocationsPage /> },
              { path: 'employees', element: <EmployeesPage /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
