import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from '../../database/database.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { RefreshThrottlerGuard } from './refresh-throttler.guard.js';
import { SessionsRepository } from './sessions.repository.js';
import { OneTimeTokensRepository } from './one-time-tokens.repository.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [
    DatabaseModule,
    OutboxModule,
    // 10 per minute per route. Signup/login/password routes count per IP (ThrottlerGuard);
    // refresh counts per login (RefreshThrottlerGuard), so staff sharing an office IP don't
    // log each other out. In memory for now; moves to Redis with multiple API instances.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    SessionsRepository,
    RefreshThrottlerGuard,
    OneTimeTokensRepository,
    PasswordHasher,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
