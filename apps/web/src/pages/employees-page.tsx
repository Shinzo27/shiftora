import { createEmployeeRequest, updateEmployeeRequest, type Employee } from '@shiftora/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarClock,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { AvailabilitySheet } from '@/components/employees/availability-sheet';
import { ErrorState, FormAlert, initials, PageHeader } from '@/components/page';
import { TextField } from '@/components/text-field';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { employeesApi, jobRolesApi } from '@/lib/api';
import {
  apiFieldErrors,
  errorMessage,
  formatRupees,
  rupeesToPaise,
  text,
  zodFieldErrors,
  type FieldErrors,
} from '@/lib/forms';
import { useOrg } from '@/lib/org-context';
import { cn } from '@/lib/utils';

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});
const helper = createColumnHelper<typeof features, Employee>();
const noRows: Employee[] = [];
/** Columns hidden on phones, so name, rate and actions fit without scrolling sideways. */
const wideOnly = new Set(['jobRoles', 'locations']);

type Editing = null | 'new' | Employee;

export function EmployeesPage() {
  const { orgId, role, locationId, locations } = useOrg();
  const canManage = role === 'owner' || role === 'manager';
  const jobRoles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
    enabled: canManage,
  });
  const employees = useInfiniteQuery({
    queryKey: ['employees', orgId, locationId],
    queryFn: ({ pageParam }) =>
      employeesApi.list(orgId, {
        ...(locationId ? { locationId } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: canManage,
  });
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Editing>(null);
  const [availabilityFor, setAvailabilityFor] = useState<Employee | null>(null);
  // ?new=1 (from ⌘K or onboarding) opens the add sheet, even when this page is already showing.
  const sheet: Editing = editing ?? (canManage && params.has('new') ? 'new' : null);

  // Drop ?new=1 once handled, so a refresh doesn't reopen the sheet.
  function openSheet(value: Editing) {
    setEditing(value);
    if (params.has('new')) setParams({}, { replace: true });
  }
  const closeSheet = () => openSheet(null);

  // Search runs over the pages loaded so far ("Load more" fetches the next page).
  const rows = useMemo(() => {
    const all = employees.data?.pages.flatMap((page) => page.items) ?? noRows;
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter((e) =>
      [e.name, e.email, e.phone].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [employees.data, search]);

  const columns = useMemo(() => {
    const roleName = new Map(jobRoles.data?.map((r) => [r.id, r.name]));
    const locationName = new Map(locations.map((l) => [l.id, l.name]));
    return helper.columns([
      helper.accessor('name', {
        header: 'Name',
        sortFn: 'alphanumeric',
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="bg-accent text-xs font-medium text-accent-foreground">
                {initials(row.original.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{row.original.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {row.original.email ?? row.original.phone ?? 'No contact details'}
              </div>
            </div>
          </div>
        ),
      }),
      helper.accessor((e) => e.jobRoleIds.map((id) => roleName.get(id) ?? '').join(', '), {
        id: 'jobRoles',
        header: 'Job roles',
        sortFn: 'alphanumeric',
        cell: ({ row }) =>
          row.original.jobRoleIds.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.jobRoleIds.map((id) => (
                <Badge key={id} variant="secondary">
                  {roleName.get(id) ?? '…'}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      }),
      helper.accessor((e) => e.locationIds.map((id) => locationName.get(id) ?? '').join(', '), {
        id: 'locations',
        header: 'Locations',
        sortFn: 'alphanumeric',
        cell: ({ getValue }) => getValue() || <span className="text-muted-foreground">—</span>,
      }),
      helper.accessor('hourlyRateMinor', {
        header: 'Rate / hour',
        sortFn: 'basic',
        cell: ({ getValue }) => (
          <span className="tabular block text-right">{formatRupees(getValue())}</span>
        ),
      }),
      helper.display({
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${row.original.name}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openSheet(row.original)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAvailabilityFor(row.original)}>
                <CalendarClock /> Availability &amp; time off
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      }),
    ]);
    // openSheet only touches state setters and the current URL params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobRoles.data, locations]);

  const table = useTable({
    features,
    columns,
    data: rows,
    state: { sorting },
    onSortingChange: setSorting,
  });

  if (!canManage) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle>Managers only</EmptyTitle>
          <EmptyDescription>Only owners and managers can see the employee list.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const loadedCount = employees.data?.pages.reduce((n, page) => n + page.items.length, 0) ?? 0;
  const locationLabel = locations.find((l) => l.id === locationId)?.name;

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          locationLabel ? `People who work at ${locationLabel}.` : 'Everyone on your team.'
        }
        actions={
          <Button onClick={() => openSheet('new')}>
            <Plus /> Add employee
          </Button>
        }
      />

      {employees.isError ? (
        <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
      ) : employees.isPending ? (
        <TableSkeleton />
      ) : loadedCount === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No employees{locationLabel ? ` at ${locationLabel}` : ''} yet</EmptyTitle>
            <EmptyDescription>
              Add the people you schedule. They don't need an account to get shifts.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => openSheet('new')}>
              <Plus /> Add employee
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative max-w-xs flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search employees"
                placeholder="Search by name, email or phone"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span className="tabular ml-auto text-sm text-muted-foreground">
              {rows.length} of {loadedCount}
              {employees.hasNextPage ? '+' : ''}
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-muted/50">
                {table.getHeaderGroups().map((group) => (
                  <TableRow key={group.id}>
                    {group.headers.map((header) => {
                      const sorted = header.column.getIsSorted();
                      const right = header.column.id === 'hourlyRateMinor';
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === 'asc'
                              ? 'ascending'
                              : sorted === 'desc'
                                ? 'descending'
                                : undefined
                          }
                          className={cn(
                            right && 'text-right',
                            wideOnly.has(header.column.id) && 'hidden md:table-cell',
                          )}
                        >
                          {header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-mx-2 text-muted-foreground"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              <table.FlexRender header={header} />
                              {sorted === 'asc' ? (
                                <ArrowUp />
                              ) : sorted === 'desc' ? (
                                <ArrowDown />
                              ) : (
                                <ArrowUpDown className="opacity-40" />
                              )}
                            </Button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </TableHead>
                      );
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getAllCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            wideOnly.has(cell.column.id) &&
                              'hidden max-w-56 whitespace-normal md:table-cell',
                          )}
                        >
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No one matches “{search}”.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {employees.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void employees.fetchNextPage()}
                disabled={employees.isFetchingNextPage}
              >
                {employees.isFetchingNextPage ? <Spinner /> : null}
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sheet ? (
            <EmployeeForm
              key={sheet === 'new' ? 'new' : sheet.id}
              employee={sheet === 'new' ? null : sheet}
              onDone={closeSheet}
            />
          ) : null}
        </SheetContent>
      </Sheet>
      <AvailabilitySheet employee={availabilityFor} onClose={() => setAvailabilityFor(null)} />
    </>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading employees">
      <Skeleton className="h-9 w-72" />
      <div className="space-y-px overflow-hidden rounded-xl border">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 bg-card p-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmployeeForm({ employee, onDone }: { employee: Employee | null; onDone: () => void }) {
  const { orgId, locationId, locations } = useOrg();
  const queryClient = useQueryClient();
  const jobRoles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
  });
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      employee
        ? employeesApi.update(orgId, employee.id, updateEmployeeRequest.parse(values))
        : employeesApi.create(orgId, createEmployeeRequest.parse(values)),
  });
  const addRole = useMutation({
    mutationFn: (name: string) => jobRolesApi.create(orgId, name),
    onSuccess: (role) => {
      void queryClient.invalidateQueries({ queryKey: ['job-roles', orgId] });
      setRoleIds((ids) => [...ids, role.id]);
      setNewRole('');
    },
    onError: (error) => toast.error(errorMessage(error) ?? 'Could not add the role'),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [newRole, setNewRole] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>(employee?.jobRoleIds ?? []);
  const [locationIds, setLocationIds] = useState<string[]>(
    employee?.locationIds ??
      (locationId ? [locationId] : locations.length === 1 ? [locations[0]!.id] : []),
  );

  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...list, id] : list.filter((x) => x !== id);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const optional = (key: string) => text(data, key).trim() || null;
    const values = {
      name: text(data, 'name'),
      email: optional('email'),
      phone: optional('phone'),
      hourlyRateMinor: rupeesToPaise(text(data, 'rate')),
      jobRoleIds: roleIds,
      locationIds,
    };
    const parsed = (employee ? updateEmployeeRequest : createEmployeeRequest).safeParse(values);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(values, {
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({ queryKey: ['employees', orgId] });
        toast.success(employee ? `${saved.name} updated` : `${saved.name} added`);
        onDone();
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle>{employee ? `Edit ${employee.name}` : 'Add an employee'}</SheetTitle>
        <SheetDescription>
          Shifts and reminders go to their email or phone. No account needed.
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="flex-1 px-4">
        <TextField
          label="Name"
          name="name"
          defaultValue={employee?.name}
          autoComplete="off"
          error={errors.name}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          defaultValue={employee?.email ?? ''}
          error={errors.email}
        />
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          placeholder="+919812345678"
          defaultValue={employee?.phone ?? ''}
          error={errors.phone}
          hint="With country code, for WhatsApp reminders"
        />
        <TextField
          label="Hourly rate (₹)"
          name="rate"
          inputMode="decimal"
          placeholder="250"
          defaultValue={employee ? (employee.hourlyRateMinor / 100).toFixed(2) : ''}
          error={errors.hourlyRateMinor}
        />

        <FieldSet>
          <FieldLegend variant="label">Job roles</FieldLegend>
          <div className="grid grid-cols-2 gap-2">
            {jobRoles.data?.map((jobRole) => (
              <Field key={jobRole.id} orientation="horizontal">
                <Checkbox
                  id={`role-${jobRole.id}`}
                  checked={roleIds.includes(jobRole.id)}
                  onCheckedChange={(on) =>
                    setRoleIds((ids) => toggle(ids, jobRole.id, on === true))
                  }
                />
                <FieldLabel htmlFor={`role-${jobRole.id}`} className="font-normal">
                  {jobRole.name}
                </FieldLabel>
              </Field>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              aria-label="New job role"
              placeholder="New role, e.g. Nurse"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (newRole.trim()) addRole.mutate(newRole.trim());
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!newRole.trim() || addRole.isPending}
              onClick={() => addRole.mutate(newRole.trim())}
            >
              {addRole.isPending ? <Spinner /> : <Plus />}
              Add
            </Button>
          </div>
        </FieldSet>

        <FieldSet data-invalid={errors.locationIds ? true : undefined}>
          <FieldLegend variant="label">Works at</FieldLegend>
          <div className="grid grid-cols-2 gap-2">
            {locations.map((location) => (
              <Field key={location.id} orientation="horizontal">
                <Checkbox
                  id={`loc-${location.id}`}
                  checked={locationIds.includes(location.id)}
                  onCheckedChange={(on) =>
                    setLocationIds((ids) => toggle(ids, location.id, on === true))
                  }
                />
                <FieldLabel htmlFor={`loc-${location.id}`} className="font-normal">
                  {location.name}
                </FieldLabel>
              </Field>
            ))}
          </div>
          {errors.locationIds ? <FieldError>{errors.locationIds}</FieldError> : null}
        </FieldSet>

        <FormAlert message={Object.keys(errors).length ? null : errorMessage(save.error)} />
      </FieldGroup>
      <SheetFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner /> : null}
          {employee ? 'Save changes' : 'Add employee'}
        </Button>
      </SheetFooter>
    </form>
  );
}
