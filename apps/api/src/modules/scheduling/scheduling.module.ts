import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { JobRolesModule } from '../job-roles/job-roles.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { OpenShiftsController } from './open-shifts.controller.js';
import { OpenShiftsService } from './open-shifts.service.js';
import { PublicationsRepository } from './publications.repository.js';
import { SchedulesRepository } from './schedules.repository.js';
import { SchedulesService } from './schedules.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { ShiftRequestsController } from './shift-requests.controller.js';
import { ShiftRequestsRepository } from './shift-requests.repository.js';
import { ShiftRequestsService } from './shift-requests.service.js';
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
  imports: [
    DatabaseModule,
    AuditModule,
    LocationsModule,
    JobRolesModule,
    EmployeesModule,
    OutboxModule,
    RealtimeModule,
  ],
  controllers: [
    SchedulingController,
    ShiftsController,
    ShiftRequestsController,
    OpenShiftsController,
  ],
  providers: [
    ShiftTemplatesService,
    SchedulesService,
    ShiftsService,
    ShiftTemplatesRepository,
    SchedulesRepository,
    ShiftsRepository,
    PublicationsRepository,
    ShiftRequestsService,
    OpenShiftsService,
    ShiftRequestsRepository,
  ],
  // Attendance checks that a punch's shift belongs to the caller at that location.
  exports: [ShiftsService],
})
export class SchedulingModule {}
