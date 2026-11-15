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
import { randomToken, sha256Hex } from '../../common/crypto.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { AppConfig } from '../../config/app-config.js';
import { PasswordHasher } from './password-hasher.js';
import { OneTimeTokensRepository } from './one-time-tokens.repository.js';
import { SessionsRepository, type NewSession } from './sessions.repository.js';
import { hashRefreshToken, TokenService } from './token.service.js';
import { UsersRepository, type User } from './users.repository.js';

/** A verification link is good for a day; a reset link for an hour, because it is a door key. */
const VERIFY_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;

const invalidToken = (): AppException =>
  new AppException(
    400,
    errorCodes.invalidToken,
    'This link is not valid any more. Ask for a new one.',
  );

const alreadyVerified = (): AppException =>
  new AppException(409, errorCodes.alreadyVerified, 'This address is already confirmed.');

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
    private readonly oneTimeTokens: OneTimeTokensRepository,
    private readonly outbox: OutboxService,
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
    await this.sendVerification(user);
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

  /**
   * Confirms an address. The token is looked up by hash and consumed with a conditional UPDATE,
   * so two clicks on one link cannot both succeed — the second is simply an invalid link.
   */
  async verifyEmail(token: string): Promise<void> {
    const now = this.clock.now();
    const record = await this.oneTimeTokens.findByHash(sha256Hex(token), 'verify_email');
    if (!record || record.usedAt || record.expiresAt <= now) throw invalidToken();

    if (!(await this.oneTimeTokens.consume(record.id, now))) throw invalidToken();
    await this.users.markEmailVerified(record.userId, now);
  }

  /**
   * Starts a password reset. **Always the same answer**, whether or not the address exists: the
   * alternative turns this endpoint into a way to ask "who works here?".
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) return;
    await this.sendPasswordReset(user);
  }

  /** Redeems a reset link: new password, every live session revoked, every other link retired. */
  async resetPassword(token: string, password: string): Promise<void> {
    const now = this.clock.now();
    const record = await this.oneTimeTokens.findByHash(sha256Hex(token), 'reset_password');
    if (!record || record.usedAt || record.expiresAt <= now) throw invalidToken();

    if (!(await this.oneTimeTokens.consume(record.id, now))) throw invalidToken();

    const passwordHash = await this.passwords.hash(password);
    await this.users.setPassword(record.userId, passwordHash);
    // Whoever knew the old password must not keep a token that proves they did.
    await this.sessions.revokeAllForUser(record.userId, now);
    this.logger.log(`password reset for user ${record.userId}`);
  }

  /** Re-issues a verification link, retiring the previous one. */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user || user.emailVerifiedAt) throw alreadyVerified();
    await this.sendVerification(user);
  }

  private async sendVerification(user: User): Promise<void> {
    const now = this.clock.now();
    await this.oneTimeTokens.retire(user.id, 'verify_email', now);
    const { token, hash } = this.newOneTimeToken();
    await this.oneTimeTokens.create({
      userId: user.id,
      purpose: 'verify_email',
      tokenHash: hash,
      expiresAt: addSeconds(now, VERIFY_TTL_HOURS * 3600),
    });
    await this.outbox.recordPlatform('auth.verify_email', {
      userId: user.id,
      email: user.email,
      name: user.name,
      token,
      expiresInHours: VERIFY_TTL_HOURS,
    });
  }

  private async sendPasswordReset(user: User): Promise<void> {
    const now = this.clock.now();
    await this.oneTimeTokens.retire(user.id, 'reset_password', now);
    const { token, hash } = this.newOneTimeToken();
    await this.oneTimeTokens.create({
      userId: user.id,
      purpose: 'reset_password',
      tokenHash: hash,
      expiresAt: addSeconds(now, RESET_TTL_HOURS * 3600),
    });
    await this.outbox.recordPlatform('auth.reset_password', {
      userId: user.id,
      email: user.email,
      name: user.name,
      token,
      expiresInHours: RESET_TTL_HOURS,
    });
  }

  private newOneTimeToken(): { token: string; hash: string } {
    const token = randomToken();
    return { token, hash: sha256Hex(token) };
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
