import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { TimeEntriesRepository } from './time-entries.repository.js';

/**
 * Time entries: geofenced clock-in/out and the reads that surround them.
 *
 * SchedulingModule is imported for one call — "is this shift really yours at this location?" —
 * and nothing else crosses the boundary.
 */
@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    EmployeesModule,
    LocationsModule,
    OrgsModule,
    SchedulingModule,
  ],
  controllers: [AttendanceController],
  providers: [AttendanceService, TimeEntriesRepository],
  exports: [AttendanceService],
})
export class AttendanceModule {}
