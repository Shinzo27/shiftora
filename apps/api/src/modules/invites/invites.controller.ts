import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  acceptInviteRequest,
  createInviteRequest,
  type AcceptInviteRequest,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type Invite,
  type OrgSummary,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles, WithoutOrg } from '../tenancy/decorators.js';
import { InvitesService } from './invites.service.js';

@Controller('invites')
export class InvitesController {
  constructor(private readonly invites: InvitesService) {}

  @Roles('owner', 'manager')
  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createInviteRequest)) body: CreateInviteRequest,
  ): Promise<CreateInviteResponse> {
    return this.invites.create(body);
  }

  @Roles('owner', 'manager')
  @Get()
  list(): Promise<Invite[]> {
    return this.invites.listOpen();
  }

  @Roles('owner', 'manager')
  @Delete(':id')
  @HttpCode(204)
  revoke(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.invites.revoke(id);
  }

  /** The invitee (logged in, with the invited email) joins the org in the code. */
  @WithoutOrg()
  @Post('accept')
  @HttpCode(200)
  accept(
    @Body(new ZodValidationPipe(acceptInviteRequest)) body: AcceptInviteRequest,
  ): Promise<OrgSummary> {
    return this.invites.accept(body.code);
  }
}
