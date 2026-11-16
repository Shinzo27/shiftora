import { Module } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';

import { AppConfig } from '../../config/app-config.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');

/**
 * Where rate-limit counters live: Redis when `REDIS_URL` is set (shared by every API instance),
 * otherwise this process's memory. A provider of its own, so Nest closes the Redis connection on
 * shutdown.
 */
@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORAGE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): ThrottlerStorage =>
        config.redisUrl
          ? new RedisThrottlerStorage(config.redisUrl)
          : new ThrottlerStorageService(),
    },
  ],
  exports: [RATE_LIMIT_STORAGE],
})
export class RateLimitModule {}
