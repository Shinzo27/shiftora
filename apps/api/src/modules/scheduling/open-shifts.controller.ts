import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { OfferResult, OpenShift, ShiftCandidates } from '@shiftora/shared';

import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { OpenShiftsService } from './open-shifts.service.js';

/**
 * Open shifts: managers see who could take one and offer it; staff see the offered ones they
 * could take. Claiming (first valid claim wins) is W5 D4.
 */
@Controller()
export class OpenShiftsController {
  constructor(private readonly openShifts: OpenShiftsService) {}

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
}
