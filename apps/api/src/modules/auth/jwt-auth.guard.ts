import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { errorCodes } from '@shiftora/shared';
import type { FastifyRequest } from 'fastify';

import { AppException } from '../../common/app-exception.js';
import { IS_PUBLIC } from './public.decorator.js';
import { TokenService } from './token.service.js';

/** Registered globally: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    const userId = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!userId) {
      throw new AppException(401, errorCodes.unauthenticated, 'Missing or invalid access token.');
    }
    request.user = { id: userId };
    return true;
  }
}
