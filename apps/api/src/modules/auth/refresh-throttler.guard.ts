import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import { readRefreshCookie } from './refresh-cookie.js';
import { SessionsRepository } from './sessions.repository.js';
import { hashRefreshToken } from './token.service.js';

/**
 * The refresh limit counts per login, not per IP.
 *
 * The web app calls /auth/refresh on every full page load, so an IP-based limit punishes a
 * clinic whose staff share one internet connection: the eleventh reload in a minute logs
 * someone out. Keying by the session family (every rotated token of one login shares it)
 * means:
 *   - people behind one IP each get their own budget;
 *   - one login, even a stolen token replayed from many IPs, is still capped;
 *   - a missing or unknown cookie falls back to the IP, so inventing random tokens does not
 *     buy a fresh budget each time.
 *
 * Costs one indexed lookup (token_hash is unique) before the refresh itself.
 */
@Injectable()
export class RefreshThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly sessions: SessionsRepository,
  ) {
    super(options, storage, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const token = readRefreshCookie(req as unknown as FastifyRequest);
    const familyId = token ? await this.sessions.familyOf(hashRefreshToken(token)) : null;
    return familyId ? `session:${familyId}` : super.getTracker(req);
  }
}
