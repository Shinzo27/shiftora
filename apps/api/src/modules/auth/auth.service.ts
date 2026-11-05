import { Inject, Injectable, Logger } from '@nestjs/common';
import { newId } from '@shiftora/db';
import { addSeconds, type Clock } from '@shiftora/domain';
import {
  errorCodes,
  type AccessTokenResponse,
  type AuthResponse,
  type AuthUser,
  type LoginRequest,
  type SignupRequest,
} from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { CLOCK } from '../../common/clock.js';
import { AppConfig } from '../../config/app-config.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsRepository, type NewSession } from './sessions.repository.js';
import { hashRefreshToken, TokenService } from './token.service.js';
import { UsersRepository, type User } from './users.repository.js';

/** Client details stored with a session, to show "your devices" later. */
export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

/** What the controller needs: a JSON body plus a refresh token to put in the cookie. */
export interface IssuedSession<Body> {
  body: Body;
  refreshToken: string;
}

const invalidCredentials = () =>
  new AppException(401, errorCodes.invalidCredentials, 'Email or password is incorrect.');
const invalidRefreshToken = () =>
  new AppException(
    401,
    errorCodes.invalidRefreshToken,
    'Your session has ended. Please log in again.',
  );

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('Auth');

  constructor(
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async signup(input: SignupRequest, meta: RequestMeta): Promise<IssuedSession<AuthResponse>> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.create({ name: input.name, email: input.email, passwordHash });
    if (!user) {
      throw new AppException(
        409,
        errorCodes.emailTaken,
        'An account with this email already exists.',
      );
    }
    return this.startSession(user, meta);
  }

  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession<AuthResponse>> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await this.passwords.verifyAgainstDummy(input.password);
      throw invalidCredentials();
    }
    if (!(await this.passwords.verify(user.passwordHash, input.password))) {
      throw invalidCredentials();
    }
    return this.startSession(user, meta);
  }

  async refresh(
    refreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<IssuedSession<AccessTokenResponse>> {
    if (!refreshToken) {
      throw invalidRefreshToken();
    }
    const next = this.newSession(meta);
    const result = await this.sessions.rotate(
      hashRefreshToken(refreshToken),
      this.clock.now(),
      next.session,
    );
    if (result.status === 'reused') {
      this.logger.warn('Refresh token reuse detected; revoked the whole session family');
    }
    if (result.status !== 'rotated') {
      throw invalidRefreshToken();
    }
    const access = await this.tokens.signAccessToken(result.userId);
    return {
      body: { accessToken: access.token, expiresIn: access.expiresIn },
      refreshToken: next.refreshToken,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.sessions.revoke(hashRefreshToken(refreshToken), this.clock.now());
    }
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      // Valid token for a deleted account.
      throw new AppException(401, errorCodes.unauthenticated, 'Please log in again.');
    }
    return toAuthUser(user);
  }

  private async startSession(user: User, meta: RequestMeta): Promise<IssuedSession<AuthResponse>> {
    const { session, refreshToken } = this.newSession(meta);
    await this.sessions.start(user.id, session);
    const access = await this.tokens.signAccessToken(user.id);
    return {
      body: { accessToken: access.token, expiresIn: access.expiresIn, user: toAuthUser(user) },
      refreshToken,
    };
  }

  private newSession(meta: RequestMeta): { session: NewSession; refreshToken: string } {
    const { token, hash } = this.tokens.newRefreshToken();
    return {
      refreshToken: token,
      session: {
        id: newId(),
        tokenHash: hash,
        expiresAt: addSeconds(this.clock.now(), this.config.refreshTokenTtlDays * 24 * 60 * 60),
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ip: meta.ip,
      },
    };
  }
}
