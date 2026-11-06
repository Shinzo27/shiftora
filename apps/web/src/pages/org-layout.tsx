import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';

import { Button, ErrorBanner, Loading } from '../components/ui.js';
import { locationsApi, orgsApi } from '../lib/api.js';
import { errorMessage } from '../lib/forms.js';
import { useLogout, useSession } from '../lib/session.js';

interface OrgContextValue {
  orgId: string;
  role: 'owner' | 'manager' | 'employee' | 'kiosk';
  /** The location chosen in the header switcher, or null for "All locations". */
  locationId: string | null;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const value = useContext(OrgContext);
  if (!value) throw new Error('useOrg() used outside OrgLayout');
  return value;
}

const storageKey = (orgId: string) => `shiftora:location:${orgId}`;

function readStoredLocation(orgId: string): string | null {
  try {
    return localStorage.getItem(storageKey(orgId));
  } catch {
    return null; // storage can be blocked; the switcher still works for this visit
  }
}

/** Everything under /o/:orgId: header with org, location switcher and navigation. */
export function OrgLayout() {
  const { orgId = '' } = useParams();
  // `key` resets the selected location when switching organisations.
  return <OrgShell key={orgId} orgId={orgId} />;
}

function OrgShell({ orgId }: { orgId: string }) {
  const session = useSession();
  const logout = useLogout();
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => orgsApi.current(orgId) });
  const locations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
    enabled: org.isSuccess,
  });
  const [stored, setStored] = useState(() => readStoredLocation(orgId));
  // Ignore a remembered location that no longer exists or is now out of scope.
  const locationId = locations.data?.some((l) => l.id === stored) ? stored : null;

  function selectLocation(id: string) {
    const value = id || null;
    setStored(value);
    try {
      if (value) localStorage.setItem(storageKey(orgId), value);
      else localStorage.removeItem(storageKey(orgId));
    } catch {
      // ignore: convenience only
    }
  }

  if (org.isPending) return <Loading />;
  if (org.isError) {
    return (
      <main className="mx-auto mt-16 max-w-md space-y-4 px-4">
        <ErrorBanner message={errorMessage(org.error)} />
        <Link className="text-teal-700 underline" to="/orgs">
          Back to your organisations
        </Link>
      </main>
    );
  }

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm font-medium ${isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:text-slate-900'}`;

  return (
    <OrgContext.Provider value={{ orgId, role: org.data.role, locationId }}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/orgs" className="font-bold text-teal-800">
            Shiftora
          </Link>
          <span className="text-sm text-slate-500">
            {org.data.name} · <span className="capitalize">{org.data.role}</span>
          </span>
          <label className="ml-auto flex items-center gap-2 text-sm">
            <span className="text-slate-500">Location</span>
            <select
              aria-label="Location"
              className="rounded-md border border-slate-300 px-2 py-1.5"
              value={locationId ?? ''}
              onChange={(event) => selectLocation(event.target.value)}
            >
              <option value="">All locations</option>
              {locations.data?.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-slate-600">{session.data?.name}</span>
          <Button variant="secondary" onClick={() => logout.mutate()}>
            Log out
          </Button>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-4 pb-2">
          <NavLink to="locations" className={navClass}>
            Locations
          </NavLink>
          <NavLink to="employees" className={navClass}>
            Employees
          </NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <Outlet />
      </main>
    </OrgContext.Provider>
  );
}
