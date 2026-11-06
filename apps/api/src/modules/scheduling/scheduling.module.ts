import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { JobRolesModule } from '../job-roles/job-roles.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { SchedulesRepository } from './schedules.repository.js';
import { SchedulesService } from './schedules.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { ShiftTemplatesRepository } from './shift-templates.repository.js';
import { ShiftTemplatesService } from './shift-templates.service.js';
import { ShiftsController } from './shifts.controller.js';
import { ShiftsRepository } from './shifts.repository.js';
import { ShiftsService } from './shifts.service.js';

/**
 * Shift templates, weekly schedules and the shifts on them. EmployeesModule is imported for
 * the availability, time off and hour limits that a shift is checked against.
 */
@Module({
  imports: [DatabaseModule, AuditModule, LocationsModule, JobRolesModule, EmployeesModule],
  controllers: [SchedulingController, ShiftsController],
  providers: [
    ShiftTemplatesService,
    SchedulesService,
    ShiftsService,
    ShiftTemplatesRepository,
    SchedulesRepository,
    ShiftsRepository,
  ],
})
export class SchedulingModule {}
