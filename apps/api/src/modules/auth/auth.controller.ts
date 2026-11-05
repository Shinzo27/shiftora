import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  loginRequest,
  signupRequest,
  type AccessTokenResponse,
  type AuthResponse,
  type AuthUser,
  type LoginRequest,
  type SignupRequest,
} from '@shiftora/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AppException } from '../../common/app-exception.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AppConfig } from '../../config/app-config.js';
import { WithoutOrg } from '../tenancy/decorators.js';
import { AuthService, type IssuedSession, type RequestMeta } from './auth.service.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';

function requestMeta(request: FastifyRequest): RequestMeta {
  return { userAgent: request.headers['user-agent'] ?? null, ip: request.ip };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('signup')
  @HttpCode(201)
  async signup(
    @Body(new ZodValidationPipe(signupRequest)) body: SignupRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    return this.withCookie(reply, await this.auth.signup(body, requestMeta(request)));
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequest)) body: LoginRequest,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    return this.withCookie(reply, await this.auth.login(body, requestMeta(request)));
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AccessTokenResponse> {
    try {
      return this.withCookie(
        reply,
        await this.auth.refresh(readRefreshCookie(request), requestMeta(request)),
      );
    } catch (error) {
      if (error instanceof AppException) {
        clearRefreshCookie(reply, this.config.secureCookies); // a dead cookie is useless
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    clearRefreshCookie(reply, this.config.secureCookies);
  }

  @WithoutOrg()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }

  private withCookie<Body>(reply: FastifyReply, issued: IssuedSession<Body>): Body {
    setRefreshCookie(
      reply,
      issued.refreshToken,
      this.config.refreshTokenTtlDays * 24 * 60 * 60,
      this.config.secureCookies,
    );
    return issued.body;
  }
}
