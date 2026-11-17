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
} from '@nestjs/common';
import {
  createPayRulesVersion,
  payRulesInForceQuery,
  type CreatePayRulesVersion,
  type PayRulesInForceQuery,
  type PayRulesInForceView,
  type PayRulesVersionView,
} from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { PayRulesService } from './pay-rules.service.js';

/**
 * Pay rules. Managers may read them (they explain a payslip); only owners change them, because
 * a pay rule is a decision about the clinic's money.
 */
@Controller('pay-rules')
export class PayRulesController {
  constructor(private readonly payRules: PayRulesService) {}

  @Roles('owner', 'manager')
  @Get()
  list(): Promise<PayRulesVersionView[]> {
    return this.payRules.list();
  }

  @Roles('owner', 'manager')
  @Get('in-force')
  inForce(
    @Query(new ZodValidationPipe(payRulesInForceQuery)) query: PayRulesInForceQuery,
  ): Promise<PayRulesInForceView> {
    return this.payRules.inForce(query.date);
  }

  @Roles('owner')
  @Post()
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createPayRulesVersion)) body: CreatePayRulesVersion,
  ): Promise<PayRulesVersionView> {
    return this.payRules.create(body);
  }

  @Roles('owner')
  @Delete(':id')
  @HttpCode(204)
  withdraw(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.payRules.withdraw(id);
  }
}
