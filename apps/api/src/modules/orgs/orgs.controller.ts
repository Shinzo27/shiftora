import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { createOrgRequest, type CreateOrgRequest, type OrgSummary } from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { WithoutOrg } from '../tenancy/decorators.js';
import { OrgsService } from './orgs.service.js';

@Controller()
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /** POST /orgs: create an organisation; the caller becomes its owner. */
  @WithoutOrg()
  @Post('orgs')
  @HttpCode(201)
  create(
    @Body(new ZodValidationPipe(createOrgRequest)) body: CreateOrgRequest,
  ): Promise<OrgSummary> {
    return this.orgs.create(body.name);
  }

  /** GET /orgs: the organisations I belong to (to pick one after login). */
  @WithoutOrg()
  @Get('orgs')
  listMine(): Promise<OrgSummary[]> {
    return this.orgs.listMine();
  }

  /** GET /org: the organisation selected with X-Org-Id. Any member. */
  @Get('org')
  current(): Promise<OrgSummary> {
    return this.orgs.current();
  }
}
