import { normalizeTimeZone } from '@shiftora/domain';
import { createLocationRequest } from '@shiftora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';

import { Button, Card, Empty, ErrorBanner, Loading, TextField } from '../components/ui.js';
import { locationsApi } from '../lib/api.js';
import { apiFieldErrors, errorMessage, zodFieldErrors, type FieldErrors } from '../lib/forms.js';
import { useOrg } from './org-layout.js';

export function LocationsPage() {
  const { orgId, role } = useOrg();
  const locations = useQuery({
    queryKey: ['locations', orgId],
    queryFn: () => locationsApi.list(orgId),
  });

  return (
    <>
      <Card title="Locations">
        {locations.isPending ? (
          <Loading />
        ) : locations.data?.length ? (
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500">
              <tr>
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Time zone</th>
                <th className="py-2 font-medium">Geofence</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {locations.data.map((location) => (
                <tr key={location.id}>
                  <td className="py-2">
                    <div className="font-medium">{location.name}</div>
                    {location.address ? (
                      <div className="text-slate-500">{location.address}</div>
                    ) : null}
                  </td>
                  <td className="py-2">{location.timezone}</td>
                  <td className="py-2">{location.radiusM} m</td>
                  <td className="py-2 capitalize">{location.status.replace('_', '-')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No locations yet.{role === 'owner' ? ' Add your first one below.' : ''}</Empty>
        )}
        <ErrorBanner message={errorMessage(locations.error)} />
      </Card>
      {role === 'owner' ? <AddLocationForm orgId={orgId} /> : null}
    </>
  );
}

function AddLocationForm({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (body: Parameters<typeof locationsApi.create>[1]) =>
      locationsApi.create(orgId, body),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  // Controlled so "Use my current location" can fill them in.
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locating, setLocating] = useState(false);

  function useCurrentPosition() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = createLocationRequest.safeParse({
      name: data.get('name'),
      address: data.get('address'),
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusM: Number(data.get('radiusM')),
      timezone: data.get('timezone'),
    });
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        form.reset();
        setLatitude('');
        setLongitude('');
        void queryClient.invalidateQueries({ queryKey: ['locations', orgId] });
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <Card title="Add a location">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={onSubmit} noValidate>
        <TextField label="Name" name="name" placeholder="Andheri" error={errors.name} />
        <TextField
          label="Address"
          name="address"
          placeholder="SV Road, Andheri West"
          error={errors.address}
        />
        <TextField
          label="Latitude"
          inputMode="decimal"
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
          error={errors.latitude}
        />
        <TextField
          label="Longitude"
          inputMode="decimal"
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
          error={errors.longitude}
        />
        <TextField
          label="Geofence radius (metres)"
          name="radiusM"
          type="number"
          defaultValue={100}
          min={25}
          max={1000}
          error={errors.radiusM}
          hint="Staff must be within this distance to clock in"
        />
        <TextField
          label="Time zone"
          name="timezone"
          defaultValue={normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}
          error={errors.timezone}
        />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            onClick={useCurrentPosition}
            disabled={locating}
          >
            {locating ? 'Locating…' : 'Use my current location'}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Add location
          </Button>
        </div>
        <div className="sm:col-span-2">
          <ErrorBanner message={Object.keys(errors).length ? null : errorMessage(create.error)} />
        </div>
      </form>
    </Card>
  );
}
