import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from '../../database/database.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordHasher } from './password-hasher.js';
import { SessionsRepository } from './sessions.repository.js';
import { OneTimeTokensRepository } from './one-time-tokens.repository.js';
import { TokenService } from './token.service.js';
import { UsersRepository } from './users.repository.js';

@Module({
  imports: [
    DatabaseModule,
    OutboxModule,
    // Applied with @UseGuards(ThrottlerGuard) on signup/login/refresh only: 10 per minute
    // per IP per route. In memory for now; moves to Redis in week 4 (multiple API instances).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsersRepository,
    SessionsRepository,
    OneTimeTokensRepository,
    PasswordHasher,
    TokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
