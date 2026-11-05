import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import type { AuthenticatedUser } from './authenticated-user.js';

/** Injects the caller set by JwtAuthGuard. Only valid on protected routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const user = context.switchToHttp().getRequest<FastifyRequest>().user;
    if (!user) {
      throw new Error('@CurrentUser() used on a route without an authenticated user (@Public?)');
    }
    return user;
  },
);
