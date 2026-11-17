import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { PayPeriodsController } from './pay-periods.controller.js';
import { PayPeriodsRepository } from './pay-periods.repository.js';
import { PayPeriodsService } from './pay-periods.service.js';
import { PayrollExportService } from './payroll-export.service.js';

/**
 * Pay periods, approval and payroll (W6 D4–D5). Attendance answers "what blocks approval"; the
 * worker computes the lines (`pay_period.approved`).
 */
@Module({
  imports: [DatabaseModule, AttendanceModule, AuditModule, OutboxModule],
  controllers: [PayPeriodsController],
  providers: [PayPeriodsService, PayPeriodsRepository, PayrollExportService],
})
export class PayPeriodsModule {}
