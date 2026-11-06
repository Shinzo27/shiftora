import { normalizeTimeZone } from '@shiftora/domain';
import { createLocationRequest, updateLocationRequest, type Location } from '@shiftora/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Crosshair, MapPin, MoreHorizontal, Pencil, Plus, Radius } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';

import { FormAlert, PageHeader } from '@/components/page';
import { TextField } from '@/components/text-field';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { locationsApi } from '@/lib/api';
import { apiFieldErrors, errorMessage, text, zodFieldErrors, type FieldErrors } from '@/lib/forms';
import { useOrg } from '@/lib/org-context';

/** Sheet state: closed, adding a new location, or editing one. */
type Editing = null | 'new' | Location;

export function LocationsPage() {
  // OrgLayout has already loaded the locations; they live in the org context.
  const { role, locations } = useOrg();
  const isOwner = role === 'owner';
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Editing>(null);
  // ?new=1 (from ⌘K or onboarding) opens the add sheet, even when this page is already showing.
  const sheet: Editing = editing ?? (isOwner && params.has('new') ? 'new' : null);

  // Drop ?new=1 once handled, so a refresh doesn't reopen the sheet.
  function openSheet(value: Editing) {
    setEditing(value);
    if (params.has('new')) setParams({}, { replace: true });
  }
  const closeSheet = () => openSheet(null);

  return (
    <>
      <PageHeader
        title="Locations"
        description="Branches and sites your team works at. Clock-in is checked against each geofence."
        actions={
          isOwner && locations.length ? (
            <Button onClick={() => openSheet('new')}>
              <Plus /> Add location
            </Button>
          ) : null
        }
      />

      {locations.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <li key={location.id}>
              <LocationCard
                location={location}
                {...(isOwner ? { onEdit: () => openSheet(location) } : {})}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MapPin />
            </EmptyMedia>
            <EmptyTitle>No locations yet</EmptyTitle>
            <EmptyDescription>
              {isOwner
                ? 'Add your first branch to start scheduling shifts there.'
                : "You haven't been given access to any location yet."}
            </EmptyDescription>
          </EmptyHeader>
          {isOwner ? (
            <EmptyContent>
              <Button onClick={() => openSheet('new')}>
                <Plus /> Add location
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}

      <Sheet open={sheet !== null} onOpenChange={(open) => !open && closeSheet()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {sheet ? (
            <LocationForm
              key={sheet === 'new' ? 'new' : sheet.id}
              location={sheet === 'new' ? null : sheet}
              onDone={closeSheet}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function LocationCard({ location, onEdit }: { location: Location; onEdit?: () => void }) {
  const readOnly = location.status === 'read_only';
  return (
    <Card className="h-full transition hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
            <MapPin className="size-4" />
          </span>
          <span className="truncate">{location.name}</span>
        </CardTitle>
        <CardDescription className="truncate">{location.address ?? 'No address'}</CardDescription>
        {onEdit ? (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${location.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={readOnly ? 'outline' : 'secondary'}>
          <span
            className={`size-1.5 rounded-full ${readOnly ? 'bg-warning' : 'bg-success'}`}
            aria-hidden="true"
          />
          {readOnly ? 'Read-only' : 'Active'}
        </Badge>
        <span className="flex items-center gap-1">
          <Clock className="size-3.5" /> {location.timezone}
        </span>
        <span className="tabular flex items-center gap-1">
          <Radius className="size-3.5" /> {location.radiusM} m
        </span>
      </CardContent>
    </Card>
  );
}

function LocationForm({ location, onDone }: { location: Location | null; onDone: () => void }) {
  const { orgId } = useOrg();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      location
        ? locationsApi.update(orgId, location.id, updateLocationRequest.parse(values))
        : locationsApi.create(orgId, createLocationRequest.parse(values)),
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  // Controlled so "Use my current location" can fill them in.
  const [latitude, setLatitude] = useState(location ? String(location.latitude) : '');
  const [longitude, setLongitude] = useState(location ? String(location.longitude) : '');
  const [status, setStatus] = useState<Location['status']>(location?.status ?? 'active');
  const [locating, setLocating] = useState(false);

  function useCurrentPosition() {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setLocating(false);
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location", {
          description: 'Allow location access, or type the coordinates.',
        });
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const address = text(data, 'address').trim();
    const values = {
      name: text(data, 'name'),
      ...(address ? { address } : {}),
      latitude: Number(latitude),
      longitude: Number(longitude),
      radiusM: Number(text(data, 'radiusM')),
      timezone: text(data, 'timezone'),
      ...(location ? { status } : {}),
    };
    const parsed = (location ? updateLocationRequest : createLocationRequest).safeParse(values);
    if (!parsed.success) return setErrors(zodFieldErrors(parsed.error));
    setErrors({});
    save.mutate(values, {
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({ queryKey: ['locations', orgId] });
        toast.success(location ? `${saved.name} updated` : `${saved.name} added`);
        onDone();
      },
      onError: (error) => setErrors(apiFieldErrors(error)),
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
      <SheetHeader>
        <SheetTitle>{location ? `Edit ${location.name}` : 'Add a location'}</SheetTitle>
        <SheetDescription>
          Staff must be inside the geofence to clock in at this location.
        </SheetDescription>
      </SheetHeader>
      <FieldGroup className="flex-1 px-4">
        <TextField
          label="Name"
          name="name"
          placeholder="Andheri"
          defaultValue={location?.name}
          error={errors.name}
        />
        <TextField
          label="Address"
          name="address"
          placeholder="SV Road, Andheri West"
          defaultValue={location?.address ?? ''}
          error={errors.address}
        />
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={useCurrentPosition}
          disabled={locating}
          className="w-fit"
        >
          {locating ? <Spinner /> : <Crosshair />}
          Use my current location
        </Button>
        <TextField
          label="Geofence radius (metres)"
          name="radiusM"
          type="number"
          defaultValue={location?.radiusM ?? 100}
          min={25}
          max={1000}
          error={errors.radiusM}
          hint="25 to 1000 m. 100 m suits most clinics."
        />
        <TextField
          label="Time zone"
          name="timezone"
          defaultValue={
            location?.timezone ??
            normalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
          }
          error={errors.timezone}
        />
        {location ? (
          <Field>
            <FieldLabel htmlFor="location-status">Status</FieldLabel>
            <Select value={status} onValueChange={(v) => setStatus(v as Location['status'])}>
              <SelectTrigger id="location-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="read_only">Read-only (no new shifts)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <FormAlert message={Object.keys(errors).length ? null : errorMessage(save.error)} />
      </FieldGroup>
      <SheetFooter>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? <Spinner /> : null}
          {location ? 'Save changes' : 'Add location'}
        </Button>
      </SheetFooter>
    </form>
  );
}
