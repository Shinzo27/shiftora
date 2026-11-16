import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  decideShiftRequest,
  listShiftRequestsQuery,
  newShiftRequest,
  type DecideShiftRequest,
  type ListShiftRequestsQuery,
  type NewShiftRequest,
  type ShiftRequestView,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { ShiftRequestsService } from './shift-requests.service.js';

/**
 * Swap and drop requests. Two audiences, two prefixes:
 * - `/me/shift-requests`: any member with a staff profile — ask, answer as the named colleague,
 *   withdraw. Every check is about the caller's own shifts, so no role is needed.
 * - `/shift-requests`: owners and managers, within their locations — the inbox and the decision.
 */
@Controller()
export class ShiftRequestsController {
  constructor(private readonly requests: ShiftRequestsService) {}

  @Post('me/shift-requests')
  @HttpCode(201)
  create(
    @CurrentMember() member: OrgMember,
    @Body(new ZodValidationPipe(newShiftRequest)) body: NewShiftRequest,
  ): Promise<ShiftRequestView> {
    return this.requests.create(member, body);
  }

  @Get('me/shift-requests')
  mine(@CurrentMember() member: OrgMember): Promise<ShiftRequestView[]> {
    return this.requests.mine(member);
  }

  @Post('me/shift-requests/:id/accept')
  @HttpCode(200)
  accept(
    @CurrentMember() member: OrgMember,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShiftRequestView> {
    return this.requests.respond(member, id, 'colleague_accept');
  }

  @Post('me/shift-requests/:id/decline')
  @HttpCode(200)
  decline(
    @CurrentMember() member: OrgMember,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShiftRequestView> {
    return this.requests.respond(member, id, 'colleague_decline');
  }

  @Post('me/shift-requests/:id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentMember() member: OrgMember,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShiftRequestView> {
    return this.requests.respond(member, id, 'cancel');
  }

  /** The inbox: open requests at the caller's locations (`?scope=all` for decided ones too). */
  @Roles('owner', 'manager')
  @Get('shift-requests')
  inbox(
    @Query(new ZodValidationPipe(listShiftRequestsQuery)) query: ListShiftRequestsQuery,
  ): Promise<ShiftRequestView[]> {
    return this.requests.inbox(query);
  }

  @Roles('owner', 'manager')
  @Get('shift-requests/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<ShiftRequestView> {
    return this.requests.get(id);
  }

  @Roles('owner', 'manager')
  @Post('shift-requests/:id/approve')
  @HttpCode(200)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideShiftRequest)) body: DecideShiftRequest,
  ): Promise<ShiftRequestView> {
    return this.requests.approve(id, body);
  }

  @Roles('owner', 'manager')
  @Post('shift-requests/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideShiftRequest)) body: DecideShiftRequest,
  ): Promise<ShiftRequestView> {
    return this.requests.reject(id, body);
  }
}
