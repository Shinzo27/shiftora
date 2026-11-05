import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { updateMemberRequest, type Member, type UpdateMemberRequest } from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { MembersService } from './members.service.js';

/** Members of the organisation selected with X-Org-Id. */
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Roles('owner', 'manager')
  @Get()
  list(): Promise<Member[]> {
    return this.members.list();
  }

  @Roles('owner')
  @Patch(':userId')
  changeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(updateMemberRequest)) body: UpdateMemberRequest,
  ): Promise<Member> {
    return this.members.changeRole(userId, body.role);
  }

  /** Any member may call this; MembersService decides who may remove whom. */
  @Delete(':userId')
  @HttpCode(204)
  remove(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    return this.members.remove(userId);
  }
}
