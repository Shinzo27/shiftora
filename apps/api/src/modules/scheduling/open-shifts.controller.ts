import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  IDEMPOTENCY_KEY_HEADER,
  type ClaimOpenShiftResult,
  type OfferResult,
  type OpenShift,
  type ShiftCandidates,
} from '@shiftora/shared';

import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { OpenShiftsService } from './open-shifts.service.js';

/**
 * Open shifts: managers see who could take one and offer it; staff see the offered ones they
 * could take, and take one. A claim needs an `Idempotency-Key`, because the request someone makes
 * from a phone in a corridor is exactly the request that gets retried.
 */
@Controller()
export class OpenShiftsController {
  constructor(
    private readonly openShifts: OpenShiftsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** Everyone at the location, eligible first, with the reasons. */
  @Roles('owner', 'manager')
  @Get('shifts/:id/candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string): Promise<ShiftCandidates> {
    return this.openShifts.candidates(id);
  }

  /** Tells the eligible staff (and only them) that this shift is open. */
  @Roles('owner', 'manager')
  @Post('shifts/:id/offer')
  @HttpCode(200)
  offer(@Param('id', ParseUUIDPipe) id: string): Promise<OfferResult> {
    return this.openShifts.offer(id);
  }

  /** Offered open shifts the caller could pick up. Any member; empty without a staff profile. */
  @Get('me/open-shifts')
  mine(@CurrentMember() member: OrgMember): Promise<OpenShift[]> {
    return this.openShifts.mine(member);
  }

  /**
   * First valid claim wins: 200 with the shift as it now stands, 409 `shift.already_taken` when
   * someone's update landed first. Retrying with the same key returns the first answer.
   */
  @Post('me/open-shifts/:id/claim')
  @HttpCode(200)
  async claim(
    @CurrentMember() member: OrgMember,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: string | undefined,
  ): Promise<ClaimOpenShiftResult> {
    const result = await this.idempotency.run<ClaimOpenShiftResult>({
      route: 'POST /me/open-shifts/:id/claim',
      key,
      // The shift and the person: the same key for a different shift is a mistake, not a retry.
      parts: [id, member.userId],
      run: async () => ({ status: 200, body: await this.openShifts.claim(member, id) }),
    });
    return result.body;
  }
}
