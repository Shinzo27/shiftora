import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  createShiftRequest,
  listShiftsQuery,
  myShiftsQuery,
  updateShiftRequest,
  type CreateShiftRequest,
  type ListShiftsQuery,
  type MyShifts,
  type MyShiftsQuery,
  type Shift,
  type ShiftWriteResult,
  type UpdateShiftRequest,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { ShiftsService } from './shifts.service.js';

/**
 * Shifts on a week's schedule. Building the rota is a manager's job; employees will read
 * their own published shifts through "my shifts" (W3), not these routes.
 *
 * POST and PATCH return `{ shift, warnings }`: the stored row plus the things a manager
 * should know (availability, time off, weekly hours, rest). Only an overlap is refused.
 */
@Roles('owner', 'manager')
@Controller()
export class ShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /**
   * The caller's own shifts — every member, not just managers. Method-level `@Roles` replaces
   * the class-level rule; a login with no staff profile gets an empty list.
   */
  @Get('me/shifts')
  @Roles('owner', 'manager', 'employee')
  mine(
    @CurrentMember() member: OrgMember,
    @Query(new ZodValidationPipe(myShiftsQuery)) query: MyShiftsQuery,
  ): Promise<MyShifts> {
    return this.shifts.listMine(member, query);
  }

  @Get('shifts')
  list(@Query(new ZodValidationPipe(listShiftsQuery)) query: ListShiftsQuery): Promise<Shift[]> {
    return this.shifts.list(query);
  }

  @Get('shifts/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Shift> {
    return this.shifts.get(id);
  }

  @Post('shifts')
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createShiftRequest)) body: CreateShiftRequest,
  ): Promise<ShiftWriteResult> {
    return this.shifts.create(body);
  }

  @Patch('shifts/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateShiftRequest)) body: UpdateShiftRequest,
  ): Promise<ShiftWriteResult> {
    return this.shifts.update(id, body);
  }

  @Delete('shifts/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.shifts.remove(id);
  }
}
