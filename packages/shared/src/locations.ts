import { isValidTimeZone, normalizeTimeZone } from '@shiftora/domain';
import { z } from 'zod';

const name = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');

/** Empty strings become null, so "clear the address" is just sending "". */
const address = z
  .string()
  .trim()
  .max(300, 'At most 300 characters')
  .transform((value) => (value === '' ? null : value))
  .nullable();

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** Geofence radius in metres. Below 25 m GPS noise rejects honest clock-ins. */
const radiusM = z.number().int().min(25, 'At least 25 m').max(1000, 'At most 1000 m');
const timezone = z
  .string()
  .trim()
  .refine(isValidTimeZone, 'Unknown time zone: use an IANA name such as Asia/Kolkata')
  .transform(normalizeTimeZone);

export const locationStatus = z.enum(['active', 'read_only']);
export type LocationStatus = z.output<typeof locationStatus>;

export const location = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  radiusM: z.number().int(),
  timezone: z.string(),
  status: locationStatus,
  createdAt: z.iso.datetime(),
});
export type Location = z.output<typeof location>;

export const createLocationRequest = z.object({
  name,
  address: address.optional(),
  latitude,
  longitude,
  radiusM: radiusM.default(100),
  timezone,
});
export type CreateLocationRequest = z.output<typeof createLocationRequest>;

/** Send only the fields to change. `status` may only be changed by owners. */
export const updateLocationRequest = z
  .object({
    name: name.optional(),
    address: address.optional(),
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    radiusM: radiusM.optional(),
    timezone: timezone.optional(),
    status: locationStatus.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to change');
export type UpdateLocationRequest = z.output<typeof updateLocationRequest>;

/** Body for creating or renaming a department or job role. */
export const nameRequest = z.object({ name });
export type NameRequest = z.output<typeof nameRequest>;

export const department = z.object({
  id: z.uuid(),
  locationId: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type Department = z.output<typeof department>;

export const jobRole = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.iso.datetime(),
});
export type JobRole = z.output<typeof jobRole>;

/** Which locations a member may use. `restricted: false` means all locations. */
export const memberLocations = z.object({
  userId: z.uuid(),
  restricted: z.boolean(),
  locationIds: z.array(z.uuid()),
});
export type MemberLocations = z.output<typeof memberLocations>;

/** Replaces the member's locations. An empty list removes the restriction (all locations). */
export const setMemberLocationsRequest = z.object({
  locationIds: z.array(z.uuid()).max(500),
});
export type SetMemberLocationsRequest = z.output<typeof setMemberLocationsRequest>;
