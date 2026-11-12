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
  Put,
  Query,
} from '@nestjs/common';
import {
  createEmployeeRequest,
  createTimeOffRequest,
  listEmployeesQuery,
  setAvailabilityRequest,
  timeOffQuery,
  updateEmployeeRequest,
  type Availability,
  type CreateEmployeeRequest,
  type CreateTimeOffRequest,
  type Employee,
  type ListEmployeesQuery,
  type Page,
  type SetAvailabilityRequest,
  type Me,
  type TimeOff,
  type TimeOffQuery,
  type UpdateEmployeeRequest,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { AvailabilityService } from './availability.service.js';
import { EmployeesService } from './employees.service.js';

/** Employees of the org selected with X-Org-Id. Owners and managers (within their scope). */
@Roles('owner', 'manager')
@Controller()
export class EmployeesController {
  constructor(
    private readonly employees: EmployeesService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * The caller's own staff profile, for the phone app. Method-level `@Roles` replaces the
   * class-level owner/manager rule: every member may call it, and a login with no staff record
   * gets `profile: null` rather than a 403.
   */
  @Get('me')
  @Roles('owner', 'manager', 'employee')
  me(@CurrentMember() member: OrgMember): Promise<Me> {
    return this.employees.findMine(member);
  }

  /** The caller's own time off (empty when their login is not on the rota). */
  @Get('me/time-off')
  @Roles('owner', 'manager', 'employee')
  myTimeOff(
    @CurrentMember() member: OrgMember,
    @Query(new ZodValidationPipe(timeOffQuery)) query: TimeOffQuery,
  ): Promise<TimeOff[]> {
    return this.availability.listMine(member.userId, query);
  }

  @Get('employees')
  list(
    @Query(new ZodValidationPipe(listEmployeesQuery)) query: ListEmployeesQuery,
  ): Promise<Page<Employee>> {
    return this.employees.list(query);
  }

  @Post('employees')
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createEmployeeRequest)) body: CreateEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.create(body);
  }

  @Get('employees/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Employee> {
    return this.employees.get(id);
  }

  /** Archive with `{ "status": "archived" }`; employees are never deleted. */
  @Patch('employees/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEmployeeRequest)) body: UpdateEmployeeRequest,
  ): Promise<Employee> {
    return this.employees.update(id, body);
  }

  @Get('employees/:id/availability')
  getAvailability(@Param('id', ParseUUIDPipe) id: string): Promise<Availability> {
    return this.availability.get(id);
  }

  @Put('employees/:id/availability')
  setAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setAvailabilityRequest)) body: SetAvailabilityRequest,
  ): Promise<Availability> {
    return this.availability.set(id, body);
  }

  @Get('employees/:id/time-off')
  listTimeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(timeOffQuery)) query: TimeOffQuery,
  ): Promise<TimeOff[]> {
    return this.availability.listTimeOff(id, query);
  }

  @Post('employees/:id/time-off')
  @HttpCode(201)
  addTimeOff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createTimeOffRequest)) body: CreateTimeOffRequest,
  ): Promise<TimeOff> {
    return this.availability.addTimeOff(id, body);
  }

  @Delete('time-off/:id')
  @HttpCode(204)
  removeTimeOff(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.availability.removeTimeOff(id);
  }
}
