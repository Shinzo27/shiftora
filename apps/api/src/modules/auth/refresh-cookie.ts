import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { API_PREFIX } from '../../configure-app.js';

export const REFRESH_COOKIE = 'shiftora_rt';

/** HttpOnly: page scripts can't read it. Strict + path: only sent to our auth routes. */
function options(secure: boolean): CookieSerializeOptions {
  return { httpOnly: true, sameSite: 'strict', secure, path: `/${API_PREFIX}/auth` };
}

export function readRefreshCookie(request: FastifyRequest): string | undefined {
  return request.cookies[REFRESH_COOKIE];
}

export function setRefreshCookie(
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  void reply.setCookie(REFRESH_COOKIE, token, { ...options(secure), maxAge: maxAgeSeconds });
}

export function clearRefreshCookie(reply: FastifyReply, secure: boolean): void {
  void reply.clearCookie(REFRESH_COOKIE, options(secure));
}
