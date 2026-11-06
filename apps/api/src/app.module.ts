import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { InvitesModule } from './modules/invites/invites.module.js';
import { JobRolesModule } from './modules/job-roles/job-roles.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    AuthModule, // global JwtAuthGuard: who is calling
    TenancyModule, // global TenancyInterceptor: which org, what role, one transaction
    OrgsModule,
    InvitesModule,
    LocationsModule,
    JobRolesModule,
    EmployeesModule,
    HealthModule,
  ],
})
export class AppModule {}
