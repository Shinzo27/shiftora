import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesRepository } from './messages.repository.js';
import { MessagesService } from './messages.service.js';

/** Dead letters, replay and the paid-message quota (W4 D4). Sending is the worker's job. */
@Module({
  imports: [DatabaseModule, AuditModule, OutboxModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesRepository],
})
export class MessagesModule {}
