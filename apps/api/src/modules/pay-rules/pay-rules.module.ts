import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { PayRulesController } from './pay-rules.controller.js';
import { PayRulesRepository } from './pay-rules.repository.js';
import { PayRulesService } from './pay-rules.service.js';

/** Versioned pay rules (W6). Exported for payroll, which prices time with them (W6 D4). */
@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [PayRulesController],
  providers: [PayRulesService, PayRulesRepository],
  exports: [PayRulesService],
})
export class PayRulesModule {}
