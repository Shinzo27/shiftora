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
  createScheduleRequest,
  createShiftTemplateRequest,
  listSchedulesQuery,
  listShiftTemplatesQuery,
  updateShiftTemplateRequest,
  type CreateScheduleRequest,
  type CreateShiftTemplateRequest,
  type ListSchedulesQuery,
  type ListShiftTemplatesQuery,
  type PublishPreview,
  type PublishResult,
  type Schedule,
  type ScheduleConflicts,
  type ShiftTemplate,
  type UpdateShiftTemplateRequest,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { SchedulesService } from './schedules.service.js';
import { ShiftsService } from './shifts.service.js';
import { ShiftTemplatesService } from './shift-templates.service.js';

/**
 * Building schedules is a manager's job. Employees will read their own published shifts
 * through "my shifts" (W3), not these routes.
 */
@Roles('owner', 'manager')
@Controller()
export class SchedulingController {
  constructor(
    private readonly templates: ShiftTemplatesService,
    private readonly schedules: SchedulesService,
    private readonly shifts: ShiftsService,
  ) {}

  @Get('shift-templates')
  listTemplates(
    @Query(new ZodValidationPipe(listShiftTemplatesQuery)) query: ListShiftTemplatesQuery,
  ): Promise<ShiftTemplate[]> {
    return this.templates.list(query);
  }

  @Post('shift-templates')
  @HttpCode(201)
  createTemplate(
    @Body(new ZodValidationPipe(createShiftTemplateRequest)) body: CreateShiftTemplateRequest,
  ): Promise<ShiftTemplate> {
    return this.templates.create(body);
  }

  @Patch('shift-templates/:id')
  updateTemplate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateShiftTemplateRequest)) body: UpdateShiftTemplateRequest,
  ): Promise<ShiftTemplate> {
    return this.templates.update(id, body);
  }

  @Delete('shift-templates/:id')
  @HttpCode(204)
  removeTemplate(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.templates.remove(id);
  }

  @Get('schedules')
  listSchedules(
    @Query(new ZodValidationPipe(listSchedulesQuery)) query: ListSchedulesQuery,
  ): Promise<Schedule[]> {
    return this.schedules.list(query);
  }

  @Get('schedules/:id')
  getSchedule(@Param('id', ParseUUIDPipe) id: string): Promise<Schedule> {
    return this.schedules.get(id);
  }

  /**
   * The week's conflict warnings in one request (availability, time off, weekly hours, rest),
   * for the badges on the board.
   */
  @Get('schedules/:id/conflicts')
  conflicts(@Param('id', ParseUUIDPipe) id: string): Promise<ScheduleConflicts> {
    return this.shifts.conflicts(id);
  }

  /** What publishing would tell staff: the diff against the last publication. */
  @Get('schedules/:id/publish-preview')
  publishPreview(@Param('id', ParseUUIDPipe) id: string): Promise<PublishPreview> {
    return this.schedules.publishPreview(id);
  }

  /** Publishes the week: one transaction, one outbox event, one audit row. */
  @Post('schedules/:id/publish')
  @HttpCode(200)
  publish(@Param('id', ParseUUIDPipe) id: string): Promise<PublishResult> {
    return this.schedules.publish(id);
  }

  @Post('schedules')
  @HttpCode(201)
  createSchedule(
    @Body(new ZodValidationPipe(createScheduleRequest)) body: CreateScheduleRequest,
  ): Promise<Schedule> {
    return this.schedules.create(body);
  }
}
