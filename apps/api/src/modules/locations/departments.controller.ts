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
} from '@nestjs/common';
import { nameRequest, type Department, type NameRequest } from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { DepartmentsService } from './departments.service.js';

@Controller()
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @Get('locations/:locationId/departments')
  list(@Param('locationId', ParseUUIDPipe) locationId: string): Promise<Department[]> {
    return this.departments.list(locationId);
  }

  @Roles('owner', 'manager')
  @Post('locations/:locationId/departments')
  @HttpCode(201)
  create(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body(new ZodValidationPipe(nameRequest)) body: NameRequest,
  ): Promise<Department> {
    return this.departments.create(locationId, body.name);
  }

  @Roles('owner', 'manager')
  @Patch('departments/:id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(nameRequest)) body: NameRequest,
  ): Promise<Department> {
    return this.departments.rename(id, body.name);
  }

  @Roles('owner', 'manager')
  @Delete('departments/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.departments.remove(id);
  }
}
