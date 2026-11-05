import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { InvitesController } from './invites.controller.js';
import { InvitesRepository } from './invites.repository.js';
import { InvitesService } from './invites.service.js';

@Module({
  imports: [DatabaseModule, AuditModule, AuthModule, OrgsModule],
  controllers: [InvitesController],
  providers: [InvitesService, InvitesRepository],
})
export class InvitesModule {}
