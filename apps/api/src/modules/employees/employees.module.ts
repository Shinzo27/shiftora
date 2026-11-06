import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { JobRolesModule } from '../job-roles/job-roles.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesRepository } from './employees.repository.js';
import { EmployeesService } from './employees.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, LocationsModule, JobRolesModule, OrgsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, AvailabilityService, EmployeesRepository, AvailabilityRepository],
  // Scheduling (week 2) checks eligibility and availability through these.
  exports: [EmployeesService, AvailabilityService],
})
export class EmployeesModule {}
