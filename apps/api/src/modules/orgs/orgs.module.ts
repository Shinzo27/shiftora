import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';
import { MembershipsRepository } from './memberships.repository.js';
import { OrgsController } from './orgs.controller.js';
import { OrgsRepository } from './orgs.repository.js';
import { OrgsService } from './orgs.service.js';

@Module({
  imports: [DatabaseModule, AuditModule],
  controllers: [OrgsController, MembersController],
  providers: [OrgsService, MembersService, OrgsRepository, MembershipsRepository],
  exports: [MembershipsRepository, OrgsRepository],
})
export class OrgsModule {}
