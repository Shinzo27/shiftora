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
import { nameRequest, type JobRole, type NameRequest } from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { JobRolesService } from './job-roles.service.js';

@Controller('job-roles')
export class JobRolesController {
  constructor(private readonly jobRoles: JobRolesService) {}

  @Get()
  list(): Promise<JobRole[]> {
    return this.jobRoles.list();
  }

  @Roles('owner', 'manager')
  @Post()
  @HttpCode(201)
  create(@Body(new ZodValidationPipe(nameRequest)) body: NameRequest): Promise<JobRole> {
    return this.jobRoles.create(body.name);
  }

  @Roles('owner', 'manager')
  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(nameRequest)) body: NameRequest,
  ): Promise<JobRole> {
    return this.jobRoles.rename(id, body.name);
  }

  @Roles('owner', 'manager')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.jobRoles.remove(id);
  }
}
