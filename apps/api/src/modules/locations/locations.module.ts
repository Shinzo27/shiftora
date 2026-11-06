import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsRepository } from './departments.repository.js';
import { DepartmentsService } from './departments.service.js';
import { LocationAccess } from './location-access.service.js';
import { LocationsController } from './locations.controller.js';
import { LocationsRepository } from './locations.repository.js';
import { LocationsService } from './locations.service.js';
import { MemberLocationsController } from './member-locations.controller.js';
import { MemberLocationsService } from './member-locations.service.js';
import { MembershipLocationsRepository } from './membership-locations.repository.js';

@Module({
  imports: [DatabaseModule, AuditModule, OrgsModule],
  controllers: [LocationsController, DepartmentsController, MemberLocationsController],
  providers: [
    LocationsService,
    DepartmentsService,
    MemberLocationsService,
    LocationAccess,
    LocationsRepository,
    DepartmentsRepository,
    MembershipLocationsRepository,
  ],
  // Shifts, schedules and clock-ins will check location access through this.
  exports: [LocationAccess],
})
export class LocationsModule {}
