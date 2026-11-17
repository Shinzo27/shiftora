import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AutofillRequestResult, AutofillRunView } from '@shiftora/shared';

import { CurrentMember, Roles } from '../tenancy/decorators.js';
import type { OrgMember } from '../tenancy/member.js';
import { AutofillService } from './autofill.service.js';

/**
 * "Fill this week from the coverage I set up" (W7 D3).
 *
 * Answers immediately with a run id; the worker does the solving and the page watches the run.
 * Only a manager can spend the branch's rota on a solver.
 */
@Controller()
export class AutofillController {
  constructor(private readonly autofill: AutofillService) {}

  @Roles('owner', 'manager')
  // Starting a solver is the most expensive thing a manager can press, so it is rate-limited on
  // the shared store as well as refused while a run is in flight.
  @UseGuards(ThrottlerGuard)
  @Post('schedules/:id/autofill')
  @HttpCode(202)
  request(
    @CurrentMember() member: OrgMember,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutofillRequestResult> {
    return this.autofill.request(id, member.userId);
  }

  @Roles('owner', 'manager')
  @Get('schedules/:id/autofill')
  latest(@Param('id', ParseUUIDPipe) id: string): Promise<AutofillRunView | null> {
    return this.autofill.latest(id);
  }
}
