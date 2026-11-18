import { Controller, Get, Query } from '@nestjs/common';
import { auditQuery, type AuditPage, type AuditQuery } from '@shiftora/shared';

import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { Roles } from '../tenancy/decorators.js';
import { AuditService } from './audit.service.js';

/**
 * The audit log (W7 D4). Owners only: it shows every change in the organisation, including pay,
 * roles and other managers' edits — a manager's own trail is not theirs to browse.
 */
@Controller('audit-events')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('owner')
  @Get()
  list(@Query(new ZodValidationPipe(auditQuery)) query: AuditQuery): Promise<AuditPage> {
    return this.audit.list(query);
  }
}
