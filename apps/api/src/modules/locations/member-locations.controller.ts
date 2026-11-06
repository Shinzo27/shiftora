import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import {
  setMemberLocationsRequest,
  type MemberLocations,
  type SetMemberLocationsRequest,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { MemberLocationsService } from './member-locations.service.js';

/** Which locations a member may use. Lives here because location access is decided here. */
@Controller('members/:userId/locations')
export class MemberLocationsController {
  constructor(private readonly memberLocations: MemberLocationsService) {}

  @Roles('owner', 'manager')
  @Get()
  get(@Param('userId', ParseUUIDPipe) userId: string): Promise<MemberLocations> {
    return this.memberLocations.get(userId);
  }

  @Roles('owner')
  @Put()
  set(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(setMemberLocationsRequest)) body: SetMemberLocationsRequest,
  ): Promise<MemberLocations> {
    return this.memberLocations.set(userId, body.locationIds);
  }
}
