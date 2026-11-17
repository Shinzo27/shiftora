import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { JobRolesModule } from '../job-roles/job-roles.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { CoverageController } from './coverage.controller.js';
import { CoverageService } from './coverage.service.js';

@Module({
  // LocationsModule for the scope checks, JobRolesModule for the names the UI shows, AuditModule
  // because changing what a branch needs is a change worth recording.
  imports: [DatabaseModule, LocationsModule, JobRolesModule, AuditModule],
  controllers: [CoverageController],
  providers: [CoverageService],
  exports: [CoverageService],
})
export class CoverageModule {}
