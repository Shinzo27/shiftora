import { createEmployeeRequest } from '@shiftora/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Button, Card, Empty, ErrorBanner, Loading, TextField } from '../components/ui.js';
import { employeesApi, jobRolesApi, locationsApi } from '../lib/api.js';
import {
  apiFieldErrors,
  errorMessage,
  formatRupees,
  rupeesToPaise,
  text,
  zodFieldErrors,
  type FieldErrors,
} from '../lib/forms.js';
import { useOrg } from './org-layout.js';

export function EmployeesPage() {
  const { orgId, role, locationId } = useOrg();
  const jobRoles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
  });
  const locations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
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
    enabled: role === 'owner' || role === 'manager',
  });

  if (role !== 'owner' && role !== 'manager') {
    return <Empty>Only owners and managers can see the employee list.</Empty>;
  }

  const roleName = new Map(jobRoles.data?.map((r) => [r.id, r.name]));
  const locationName = new Map(locations.data?.map((l) => [l.id, l.name]));
  const rows = employees.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <Card title="Employees">
        {employees.isPending ? (
          <Loading />
        ) : rows.length ? (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Job roles</th>
                <th className="py-2 font-medium">Locations</th>
                <th className="py-2 text-right font-medium">Rate / hour</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((employee) => (
                <tr key={employee.id}>
                  <td className="py-2">
                    <div className="font-medium">{employee.name}</div>
                    <div className="text-slate-500">{employee.email ?? employee.phone ?? ''}</div>
                  </td>
                  <td className="py-2">
                    {employee.jobRoleIds.map((id) => roleName.get(id)).join(', ') || '—'}
                  </td>
                  <td className="py-2">
                    {employee.locationIds.map((id) => locationName.get(id)).join(', ') || '—'}
                  </td>
                  <td className="py-2 text-right">{formatRupees(employee.hourlyRateMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No employees{locationId ? ' at this location' : ''} yet.</Empty>
        )}
        {employees.hasNextPage ? (
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => void employees.fetchNextPage()}
            disabled={employees.isFetchingNextPage}
          >
            Load more
          </Button>
        ) : null}
        <ErrorBanner message={errorMessage(employees.error)} />
      </Card>
      <AddEmployeeForm />
    </>
  );
}

function AddEmployeeForm() {
  const { orgId, locationId } = useOrg();
  const queryClient = useQueryClient();
  const jobRoles = useQuery({
    queryKey: ['job-roles', orgId],
    queryFn: () => jobRolesApi.list(orgId),
  });
  const locations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
  });
  const create = useMutation({
    mutationFn: (body: Parameters<typeof employeesApi.create>[1]) =>
      employeesApi.create(orgId, body),
  });
  const addRole = useMutation({
    mutationFn: (name: string) => jobRolesApi.create(orgId, name),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['job-roles', orgId] }),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [newRole, setNewRole] = useState('');

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const optional = (key: string) => {
      const value = text(data, key).trim();
      return value === '' ? null : value;
    };
    const parsed = createEmployeeRequest.safeParse({
      name: data.get('name'),
      email: optional('email'),
      phone: optional('phone'),
      hourlyRateMinor: rupeesToPaise(text(data, 'rate')),
      jobRoleIds: data.getAll('jobRoleIds'),
      locationIds: data.getAll('locationIds'),
    });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        form.reset();
        void queryClient.invalidateQueries({ queryKey: ['employees', orgId] });
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <Card title="Add an employee">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
        <TextField label="Name" name="name" error={errors.name} />
        <TextField label="Email" name="email" type="email" error={errors.email} />
        <TextField label="Phone" name="phone" placeholder="+919812345678" error={errors.phone} />
        <TextField
          label="Hourly rate (₹)"
          name="rate"
          inputMode="decimal"
          placeholder="250"
          error={errors.hourlyRateMinor}
        />

        <fieldset className="text-sm">
          <legend className="font-medium text-slate-700">Job roles</legend>
          <div className="mt-2 space-y-1">
            {jobRoles.data?.map((jobRole) => (
              <label key={jobRole.id} className="flex items-center gap-2">
                <input type="checkbox" name="jobRoleIds" value={jobRole.id} />
                {jobRole.name}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              aria-label="New job role"
              className="flex-1 rounded-md border border-slate-300 px-2 py-1"
              placeholder="e.g. Nurse"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!newRole.trim() || addRole.isPending}
              onClick={() => addRole.mutate(newRole.trim(), { onSuccess: () => setNewRole('') })}
            >
              Add role
            </Button>
          </div>
          <ErrorBanner message={errorMessage(addRole.error)} />
        </fieldset>

        <fieldset className="text-sm">
          <legend className="font-medium text-slate-700">Works at</legend>
          <div className="mt-2 space-y-1">
            {locations.data?.map((location) => (
              <label key={location.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="locationIds"
                  value={location.id}
                  defaultChecked={location.id === locationId || locations.data.length === 1}
                />
                {location.name}
              </label>
            ))}
          </div>
          {errors.locationIds ? <p className="mt-1 text-red-600">{errors.locationIds}</p> : null}
        </fieldset>

        <div className="sm:col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Add employee
          </Button>
        </div>
        <div className="sm:col-span-2">
          <ErrorBanner message={Object.keys(errors).length ? null : errorMessage(create.error)} />
        </div>
      </form>
    </Card>
  );
}
