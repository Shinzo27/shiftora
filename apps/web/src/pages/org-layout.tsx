import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronsUpDown,
  Clock,
  IndianRupee,
  MapPin,
  ArrowLeftRight,
  MessagesSquare,
  Plus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router';

import { CommandMenu } from '@/components/command-menu';
import { LogoMark } from '@/components/logo';
import { ErrorState } from '@/components/page';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import { UserMenu } from '@/components/user-menu';
import { locationsApi, orgsApi } from '@/lib/api';
import { OrgContext, readStoredLocation, storeLocation, useOrg } from '@/lib/org-context';

/** Everything under /o/:orgId: sidebar, top bar with switchers, and the page. */
export function OrgLayout() {
  const { orgId = '' } = useParams();
  // `key` resets the selected location when switching organisations.
  return <OrgShell key={orgId} orgId={orgId} />;
}

function OrgShell({ orgId }: { orgId: string }) {
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => orgsApi.current(orgId) });
  const locations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
    enabled: org.isSuccess,
  });
  const [stored, setStored] = useState(() => readStoredLocation(orgId));

  const failed = org.isError ? org : locations.isError ? locations : null;
  if (failed) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4">
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        <p className="mt-4 text-center text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" to="/orgs">
            Back to your organisations
          </Link>
        </p>
      </main>
    );
  }
  if (!org.isSuccess || !locations.isSuccess) return <ShellSkeleton />;

  const list = locations.data;
  // Ignore a remembered location that no longer exists or is now out of scope.
  const locationId = list.some((l) => l.id === stored) ? stored : null;

  function selectLocation(id: string | null) {
    setStored(id);
    storeLocation(orgId, id);
  }

  return (
    <OrgContext.Provider
      value={{
        orgId,
        org: org.data,
        role: org.data.role,
        locations: list,
        locationId,
        selectLocation,
      }}
    >
      <SidebarProvider>
        <AppSidebar />
        {/* min-w-0: as a flex item it would otherwise grow to its widest child (a table), and
            the whole page would scroll sideways instead of the table scrolling in its box. */}
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-1 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
            />
            <LocationSwitcher />
            <div className="ml-auto flex items-center gap-2">
              <CommandMenu />
            </div>
          </header>
          {/* SidebarInset is the page's <main>; this is just the content column. */}
          <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </OrgContext.Provider>
  );
}

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Shown but disabled until the feature ships. */
  soon?: boolean;
  managersOnly?: boolean;
  ownerOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: 'Schedule', to: 'schedule', icon: CalendarDays, managersOnly: true },
  { label: 'Employees', to: 'employees', icon: Users, managersOnly: true },
  { label: 'Locations', to: 'locations', icon: MapPin },
  { label: 'Timesheets', to: 'timesheets', icon: Clock, managersOnly: true },
  { label: 'Requests', to: 'requests', icon: ArrowLeftRight, managersOnly: true },
  { label: 'Messages', to: 'messages', icon: MessagesSquare, ownerOnly: true },
  { label: 'Payroll', to: 'payroll', icon: IndianRupee, soon: true },
];

function AppSidebar() {
  const { role } = useOrg();
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const canManage = role === 'owner' || role === 'manager';

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <OrgSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {navItems
              .filter((item) => canManage || !item.managersOnly)
              .filter((item) => role === 'owner' || !item.ownerOnly)
              .map((item) => (
                <SidebarMenuItem key={item.to}>
                  {item.soon ? (
                    <>
                      <SidebarMenuButton tooltip={`${item.label} (coming soon)`} disabled>
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge>
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          Soon
                        </Badge>
                      </SidebarMenuBadge>
                    </>
                  ) : (
                    <SidebarMenuButton
                      asChild
                      tooltip={item.label}
                      isActive={pathname.endsWith(`/${item.to}`)}
                    >
                      <NavLink to={item.to} onClick={() => isMobile && setOpenMobile(false)}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu side={isMobile ? 'top' : 'right'} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Org name + role in the sidebar header; opens a menu to switch or create an org. */
function OrgSwitcher() {
  const { org, orgId } = useOrg();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();
  const orgs = useQuery({ queryKey: ['orgs'], queryFn: orgsApi.list });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <LogoMark />
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{org.name}</span>
                <span className="truncate text-xs capitalize text-muted-foreground">
                  {org.role}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? 'bottom' : 'right'}
            align="start"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Organisations
            </DropdownMenuLabel>
            {orgs.data?.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => void navigate(`/o/${item.id}`)}
                className={item.id === orgId ? 'font-medium' : undefined}
              >
                <span className="flex size-6 items-center justify-center rounded-md border text-xs">
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="truncate">{item.name}</span>
                <span className="ml-auto text-xs capitalize text-muted-foreground">
                  {item.role}
                </span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void navigate('/orgs?new=1')}>
              <Plus /> Create organisation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

const ALL = 'all';

function LocationSwitcher() {
  const { locations, locationId, selectLocation } = useOrg();
  if (!locations.length) return null;

  return (
    <Select
      value={locationId ?? ALL}
      onValueChange={(value) => selectLocation(value === ALL ? null : value)}
    >
      <SelectTrigger
        size="sm"
        aria-label="Location"
        className="w-auto max-w-56 gap-2 border-none shadow-none"
      >
        <MapPin className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={ALL}>All locations</SelectItem>
        {locations.map((location) => (
          <SelectItem key={location.id} value={location.id}>
            {location.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-svh" aria-busy="true" aria-label="Loading">
      <div className="hidden w-64 space-y-3 border-r p-4 md:block">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-8 w-3/4" />
      </div>
      <div className="flex-1 space-y-6 p-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
