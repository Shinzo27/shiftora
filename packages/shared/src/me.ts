import { z } from 'zod';

import { notifyChannel, timeOff } from './employees.js';
import { memberRole } from './orgs.js';
import { localDate } from './scheduling.js';
import { shift } from './shifts.js';

/**
 * What a signed-in person sees about themselves, whatever their role.
 *
 * A manager who also works shifts has a profile; an owner who only administers does not, and
 * every endpoint here answers that with `profile: null` instead of an error — "you are not on
 * the rota" is a normal state, not a failure.
 */
export const myShift = shift.extend({
  locationName: z.string(),
  locationTimezone: z.string(),
  jobRoleName: z.string().nullable(),
});
export type MyShift = z.output<typeof myShift>;

export const myLocation = z.object({
  id: z.uuid(),
  name: z.string(),
  timezone: z.string(),
});
export type MyLocation = z.output<typeof myLocation>;

export const myProfile = z.object({
  employeeId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notifyChannel,
  jobRoleNames: z.array(z.string()),
  locations: z.array(myLocation),
});
export type MyProfile = z.output<typeof myProfile>;

export const me = z.object({
  userId: z.uuid(),
  role: memberRole,
  profile: myProfile.nullable(),
});
export type Me = z.output<typeof me>;

/** The range is in the local dates the shifts are shown in, not UTC days. */
export const myShiftsQuery = z
  .object({ from: localDate, to: localDate })
  .refine((query) => query.from <= query.to, {
    path: ['to'],
    message: 'The end of the range must not be before the start',
  });
export type MyShiftsQuery = z.output<typeof myShiftsQuery>;

export const myShifts = z.object({ items: z.array(myShift) });
export type MyShifts = z.output<typeof myShifts>;

export const myTimeOff = z.object({ items: z.array(timeOff) });
export type MyTimeOff = z.output<typeof myTimeOff>;
