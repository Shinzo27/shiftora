import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { PayLocksService } from './pay-locks.service.js';

/** Payroll's one question for other modules: is this date already paid? */
@Module({
  imports: [DatabaseModule],
  providers: [PayLocksService],
  exports: [PayLocksService],
})
export class PayLocksModule {}
