import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import {
  createPayPeriod,
  payrollExportQuery,
  type PayrollExportQuery,
  type CreatePayPeriod,
  type PayPeriodView,
  type PayrollEmployee,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { PayPeriodsService } from './pay-periods.service.js';
import { PayrollExportService } from './payroll-export.service.js';

/**
 * Pay periods. Managers set them up and see what blocks approval; only an owner approves and
 * sees the money (owner's decision: payroll is the clinic's money).
 */
@Controller('pay-periods')
export class PayPeriodsController {
  constructor(
    private readonly periods: PayPeriodsService,
    private readonly exports: PayrollExportService,
  ) {}

  @Roles('owner', 'manager')
  @Get()
  list(): Promise<PayPeriodView[]> {
    return this.periods.list();
  }

  @Roles('owner', 'manager')
  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createPayPeriod)) body: CreatePayPeriod,
  ): Promise<PayPeriodView> {
    return this.periods.create(body);
  }

  @Roles('owner', 'manager')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PayPeriodView> {
    return this.periods.get(id);
  }

  @Roles('owner', 'manager')
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.periods.remove(id);
  }

  @Roles('owner')
  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string): Promise<PayPeriodView> {
    return this.periods.approve(id);
  }

  @Roles('owner')
  @Get(':id/payroll')
  payroll(@Param('id', ParseUUIDPipe) id: string): Promise<PayrollEmployee[]> {
    return this.periods.payroll(id);
  }

  /**
   * The approved period as a file, streamed: `?format=csv&view=summary|lines` or `?format=xlsx`
   * (both sheets). Owner only, like the payroll it carries.
   */
  @Roles('owner')
  @Get(':id/export')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(payrollExportQuery)) query: PayrollExportQuery,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.exports.export(id, query, reply);
  }
}
