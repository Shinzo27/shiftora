import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { DeadLetter, MessageUsage, ReplayResult } from '@shiftora/shared';

import { Roles } from '../tenancy/decorators.js';
import { MessagesService } from './messages.service.js';

/**
 * Message operations for the owner: failed deliveries and the paid-message quota. Owner-only
 * because these are org-wide (a message is not tied to one location) and replaying one spends
 * the clinic's money.
 */
@Roles('owner')
@Controller('messages')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  /** Deliveries that failed every retry, newest first. */
  @Get('dead-letters')
  deadLetters(): Promise<DeadLetter[]> {
    return this.messages.deadLetters();
  }

  /** Queues a dead letter again (through the outbox; the worker sends it). */
  @Post('dead-letters/:id/replay')
  @HttpCode(200)
  replay(@Param('id', ParseUUIDPipe) id: string): Promise<ReplayResult> {
    return this.messages.replay(id);
  }

  /** This month's WhatsApp and SMS against the quota. */
  @Get('usage')
  usage(): Promise<MessageUsage> {
    return this.messages.usage();
  }
}
