import { z } from 'zod';

// Emails keep the user's casing; the database column is citext, so uniqueness and
// lookups are case-insensitive anyway.
const email = z.string().trim().pipe(z.email('Invalid email').max(254));

// NIST 800-63B: length matters, composition rules don't. Never trimmed.
const newPassword = z.string().min(8, 'At least 8 characters').max(128, 'At most 128 characters');

const name = z.string().trim().min(1, 'Required').max(100, 'At most 100 characters');

export const signupRequest = z.object({ name, email, password: newPassword });
export type SignupRequest = z.output<typeof signupRequest>;

// Login doesn't re-apply the signup policy: a policy change must not lock people out.
export const loginRequest = z.object({ email, password: z.string().min(1, 'Required').max(128) });
export type LoginRequest = z.output<typeof loginRequest>;

export const authUser = z.object({
  id: z.uuid(),
  email: z.string(),
  name: z.string(),
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AuthUser = z.output<typeof authUser>;

export const accessTokenResponse = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
});
export type AccessTokenResponse = z.output<typeof accessTokenResponse>;

export const authResponse = accessTokenResponse.extend({ user: authUser });
export type AuthResponse = z.output<typeof authResponse>;
