import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { JobRolesController } from './job-roles.controller.js';
import { JobRolesRepository } from './job-roles.repository.js';
import { JobRolesService } from './job-roles.service.js';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [JobRolesController],
  providers: [JobRolesService, JobRolesRepository],
})
export class JobRolesModule {}
