import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { JobRolesModule } from '../job-roles/job-roles.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { SchedulesRepository } from './schedules.repository.js';
import { SchedulesService } from './schedules.service.js';
import { SchedulingController } from './scheduling.controller.js';
import { ShiftTemplatesRepository } from './shift-templates.repository.js';
import { ShiftTemplatesService } from './shift-templates.service.js';

/** Shift templates and weekly schedules; shifts join in W2 D2. */
@Module({
  imports: [DatabaseModule, AuditModule, LocationsModule, JobRolesModule],
  controllers: [SchedulingController],
  providers: [
    ShiftTemplatesService,
    SchedulesService,
    ShiftTemplatesRepository,
    SchedulesRepository,
  ],
})
export class SchedulingModule {}
