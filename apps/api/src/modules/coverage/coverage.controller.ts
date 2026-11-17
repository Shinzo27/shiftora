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
import {
  createCoverageRequirement,
  updateCoverageRequirement,
  type CoverageRequirementView,
  type CreateCoverageRequirement,
  type UpdateCoverageRequirement,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { CoverageService } from './coverage.service.js';

/**
 * Standing coverage per branch: the auto-scheduler's input (W7 D1).
 *
 * Managers and owners only — an employee does not decide how many nurses a branch needs — and
 * every route goes through `LocationAccess`, so a manager scoped to one branch cannot describe
 * the staffing of another.
 */
@Controller()
export class CoverageController {
  constructor(private readonly coverage: CoverageService) {}

  @Roles('owner', 'manager')
  @Get('locations/:locationId/coverage')
  list(
    @Param('locationId', ParseUUIDPipe) locationId: string,
  ): Promise<CoverageRequirementView[]> {
    return this.coverage.list(locationId);
  }

  @Roles('owner', 'manager')
  @Post('locations/:locationId/coverage')
  @HttpCode(201)
  create(
    @Param('locationId', ParseUUIDPipe) locationId: string,
    @Body(new ZodValidationPipe(createCoverageRequirement)) body: CreateCoverageRequirement,
  ): Promise<CoverageRequirementView> {
    return this.coverage.create(locationId, body);
  }

  @Roles('owner', 'manager')
  @Patch('coverage/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCoverageRequirement)) body: UpdateCoverageRequirement,
  ): Promise<CoverageRequirementView> {
    return this.coverage.update(id, body);
  }

  @Roles('owner', 'manager')
  @Delete('coverage/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.coverage.remove(id);
  }
}
