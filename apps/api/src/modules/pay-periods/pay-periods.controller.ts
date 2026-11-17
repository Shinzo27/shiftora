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
  createPayPeriod,
  type CreatePayPeriod,
  type PayPeriodView,
  type PayrollEmployee,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { PayPeriodsService } from './pay-periods.service.js';

/**
 * Pay periods. Managers set them up and see what blocks approval; only an owner approves and
 * sees the money (owner's decision: payroll is the clinic's money).
 */
@Controller('pay-periods')
export class PayPeriodsController {
  constructor(private readonly periods: PayPeriodsService) {}

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
}
