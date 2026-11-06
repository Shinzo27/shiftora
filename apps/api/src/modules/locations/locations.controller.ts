import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import {
  createLocationRequest,
  updateLocationRequest,
  type CreateLocationRequest,
  type Location,
  type UpdateLocationRequest,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { LocationsService } from './locations.service.js';

/** Locations of the org selected with X-Org-Id, limited to the caller's location scope. */
@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  list(): Promise<Location[]> {
    return this.locations.list();
  }

  @Roles('owner')
  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createLocationRequest)) body: CreateLocationRequest,
  ): Promise<Location> {
    return this.locations.create(body);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Location> {
    return this.locations.get(id);
  }

  @Roles('owner', 'manager')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateLocationRequest)) body: UpdateLocationRequest,
  ): Promise<Location> {
    return this.locations.update(id, body);
  }
}
