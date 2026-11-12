import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { OutboxService } from './outbox.service.js';

/** Writing events for the worker; reading them is the relay's job (week 4). */
@Module({
  imports: [DatabaseModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
