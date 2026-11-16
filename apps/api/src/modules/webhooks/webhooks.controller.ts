import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { errorCodes } from '@shiftora/shared';
import type { FastifyRequest } from 'fastify';

import { AppException } from '../../common/app-exception.js';
import { AppConfig } from '../../config/app-config.js';
import { Public } from '../auth/public.decorator.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { readMetaStatuses, verifyMetaSignature } from './meta-webhook.js';

/**
 * Provider webhooks: how WhatsApp tells us a message was delivered, read or not delivered.
 *
 * Public (Meta has no token of ours) but not open: every POST must carry Meta's
 * `X-Hub-Signature-256`, an HMAC of the exact bytes with the app secret only Meta and we know.
 * A verified report is written to the outbox as a `delivery.reported` platform event and the
 * handler returns at once — Meta wants a fast 200, and finding the delivery, updating it and
 * falling back on a failure are the worker's job (AGENTS.md: no provider work in a request).
 */
@Public()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly config: AppConfig,
    private readonly outbox: OutboxService,
  ) {}

  /** Meta's one-time handshake when the webhook URL is registered: echo the challenge. */
  @Get('whatsapp')
  @Header('content-type', 'text/plain')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expected = this.config.whatsappVerifyToken;
    if (!expected) throw notConfigured();
    if (mode !== 'subscribe' || token !== expected || !challenge) {
      throw new AppException(403, errorCodes.forbidden, 'The verify token does not match.');
    }
    return challenge;
  }

  @Post('whatsapp')
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Body() body: unknown,
  ): Promise<{ received: number }> {
    const secret = this.config.whatsappAppSecret;
    if (!secret) throw notConfigured();

    const signature = request.headers['x-hub-signature-256'];
    const valid =
      request.rawBody !== undefined &&
      verifyMetaSignature(
        request.rawBody,
        typeof signature === 'string' ? signature : undefined,
        secret,
      );
    if (!valid) {
      throw new AppException(
        401,
        errorCodes.webhookBadSignature,
        'The webhook signature does not match.',
      );
    }

    // Not a WhatsApp Business webhook, or one with no statuses (an incoming message): nothing to
    // record, but still a 200, or Meta keeps retrying something we will never want.
    const reports = readMetaStatuses(body) ?? [];
    if (reports.length > 0) {
      await this.outbox.recordPlatform('delivery.reported', { channel: 'whatsapp', reports });
    }
    return { received: reports.length };
  }
}

function notConfigured(): AppException {
  return new AppException(
    404,
    errorCodes.webhookNotConfigured,
    'The WhatsApp webhook is not configured.',
  );
}
