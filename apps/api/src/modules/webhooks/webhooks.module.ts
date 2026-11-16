import { Module } from '@nestjs/common';

import { OutboxModule } from '../outbox/outbox.module.js';
import { WebhooksController } from './webhooks.controller.js';

/** Provider callbacks (delivery reports). Verified here, handled by the worker via the outbox. */
@Module({
  imports: [OutboxModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}
