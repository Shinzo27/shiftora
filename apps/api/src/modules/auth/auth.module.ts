import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';

import { RATE_LIMIT_STORAGE, RateLimitModule } from '../../common/rate-limit/rate-limit.module.js';

import { DatabaseModule } from '../../database/database.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { LoginThrottlerGuard } from './login-throttler.guard.js';
import { RefreshThrottlerGuard } from './refresh-throttler.guard.js';
import { SessionsRepository } from './sessions.repository.js';
import { OneTimeTokensRepository } from './one-time-tokens.repository.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [
    DatabaseModule,
    OutboxModule,
    // 10 per minute per route, counted in Redis when REDIS_URL is set so every API instance
    // enforces the same number. *Who* is counted is the guard's business, not this config's:
    // LoginThrottlerGuard keys by account (a password is guessed for one account), and
    // RefreshThrottlerGuard by session family (devices must not log each other out). Trackers
    // set here would override both, because a throttler's own `getTracker` wins over the guard's
    // — which is exactly how a refresh limit once became an address limit and logged everyone out.
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage: ThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 10 }],
        storage,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    SessionsRepository,
    LoginThrottlerGuard,
    RefreshThrottlerGuard,
    OneTimeTokensRepository,
    PasswordHasher,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
