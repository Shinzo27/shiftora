import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { errorCodes, pushSubscribeRequest, type PushSubscribeRequest } from '@shiftora/shared';

import { AppException } from '../../common/app-exception.js';
import { Public } from '../auth/public.decorator.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AppConfig } from '../../config/app-config.js';
import { EmployeesService } from '../employees/employees.service.js';
import { CurrentMember } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { PushSubscriptionsRepository } from './push-subscriptions.repository.js';

/**
 * Web Push for the staff app.
 *
 * The public VAPID key is not a secret — it is the identity a push service checks the server's
 * signature against — so it is served to any signed-in member rather than baked into the bundle,
 * which would make rotating the key a redeploy.
 */
@Controller()
export class PushController {
  constructor(
    private readonly subscriptions: PushSubscriptionsRepository,
    private readonly employees: EmployeesService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('push/public-key')
  publicKey(): { publicKey: string | null } {
    return { publicKey: this.config.vapidPublicKey };
  }

  /** Idempotent: the same browser subscribing twice keeps one row. */
  @Post('me/push-subscriptions')
  @HttpCode(201)
  async subscribe(
    @CurrentMember() member: OrgMember,
    @Body(new ZodValidationPipe(pushSubscribeRequest)) body: PushSubscribeRequest,
  ): Promise<{ subscribed: true }> {
    const employee = await this.employees.findByUserId(member.userId);
    if (!employee) {
      throw new AppException(
        404,
        errorCodes.employeeNotFound,
        'This account has no employee record in this organisation.',
      );
    }

    await this.subscriptions.save(member.orgId, employee.id, {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return { subscribed: true };
  }

  /**
   * Unsubscribing is best-effort: the browser may already have discarded the subscription, and a
   * 404 would be noise in the console of a page that is closing.
   */
  @Delete('me/push-subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentMember() member: OrgMember,
    @Body(new ZodValidationPipe(pushSubscribeRequest)) body: PushSubscribeRequest,
  ): Promise<void> {
    const employee = await this.employees.findByUserId(member.userId);
    if (!employee) return;
    await this.subscriptions.remove(member.orgId, employee.id, body.endpoint);
  }
}
