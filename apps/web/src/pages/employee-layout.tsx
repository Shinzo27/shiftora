import { useQuery } from '@tanstack/react-query';
import { CalendarDays, CircleUser, Plane } from 'lucide-react';
import { Suspense } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';

import { LogoMark } from '@/components/logo';
import { ErrorState } from '@/components/page';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { UserMenu } from '@/components/user-menu';
import { orgsApi } from '@/lib/api';
import { OrgContext } from '@/lib/org-context';
import { cn } from '@/lib/utils';

const TABS = [
  { to: 'shifts', label: 'Shifts', icon: CalendarDays },
  { to: 'time-off', label: 'Time off', icon: Plane },
  { to: 'profile', label: 'Profile', icon: CircleUser },
] as const;

/**
 * The staff app: what a phone shows, not a shrunken dashboard.
 *
 * Same organisation context as the manager shell (the org comes from the URL and becomes the
 * `X-Org-Id` header), but a one-column layout capped at phone width, a sticky header and a
 * bottom tab bar — the shape people already know from every app on their phone. There is no
 * location switcher and no sidebar: an employee works where they are told to, and the shifts
 * they see come from `/me/shifts`.
 */
export function EmployeeLayout() {
  const { orgId = '' } = useParams();
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => orgsApi.current(orgId) });

  if (org.isError) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4">
        <ErrorState error={org.error} onRetry={() => void org.refetch()} />
      </main>
    );
  }
  if (!org.isSuccess) {
    return (
      <div className="mx-auto w-full max-w-md space-y-3 p-4" aria-busy="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <OrgContext.Provider
      value={{
        orgId,
        org: org.data,
        role: org.data.role,
        // A staff member has no location scope to switch; pages read locations from /me.
        locations: [],
        locationId: null,
        selectLocation: () => undefined,
      }}
    >
      <div className="flex min-h-svh flex-col bg-muted/40">
        <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2.5 px-4">
            <LogoMark className="size-8" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{org.data.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">Shifts & attendance</p>
            </div>
            <div className="ml-auto">
              <UserMenu compact />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-md flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))]">
          <Suspense
            fallback={
              <div className="flex justify-center py-16">
                <Spinner className="text-muted-foreground" aria-label="Loading" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>

        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
        >
          <ul className="mx-auto flex w-full max-w-md">
            {TABS.map((tab) => (
              <li key={tab.to} className="flex-1">
                <NavLink
                  to={tab.to}
                  className={({ isActive }) =>
                    cn(
                      'flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium transition-colors',
                      isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <tab.icon className="size-5" aria-hidden="true" />
                      <span className={isActive ? 'font-semibold' : undefined}>{tab.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </OrgContext.Provider>
  );
}
