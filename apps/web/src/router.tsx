import { createBrowserRouter, Navigate, Outlet } from 'react-router';

import { Loading } from './components/ui.js';
import { useSession } from './lib/session.js';
import { AuthPage } from './pages/auth-page.js';
import { EmployeesPage } from './pages/employees-page.js';
import { LocationsPage } from './pages/locations-page.js';
import { OrgLayout } from './pages/org-layout.js';
import { OrgsPage } from './pages/orgs-page.js';

/** Waits for the session check on page load, then lets logged-in users through. */
function RequireAuth() {
  const session = useSession();
  if (session.isPending) return <Loading label="Signing you in…" />;
  return session.data ? <Outlet /> : <Navigate to="/login" replace />;
}

export const router = createBrowserRouter([
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
          { index: true, element: <Navigate to="locations" replace /> },
          { path: 'locations', element: <LocationsPage /> },
          { path: 'employees', element: <EmployeesPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
