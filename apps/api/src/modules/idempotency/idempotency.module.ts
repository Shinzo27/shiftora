import { Global, Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { IdempotencyKeysRepository } from './idempotency-keys.repository.js';
import { IdempotencyService } from './idempotency.service.js';

/**
 * `@Global` because it is infrastructure, not a feature: any route that must survive a retry
 * injects the service without importing a module for it.
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [IdempotencyKeysRepository, IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
