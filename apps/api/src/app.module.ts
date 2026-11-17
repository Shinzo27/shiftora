import { Module } from '@nestjs/common';

import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { CoverageModule } from './modules/coverage/coverage.module.js';
import { HealthModule } from './health/health.module.js';
import { AttendanceModule } from './modules/attendance/attendance.module.js';
import { AutofillModule } from './modules/autofill/autofill.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { InvitesModule } from './modules/invites/invites.module.js';
import { JobRolesModule } from './modules/job-roles/job-roles.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { MessagesModule } from './modules/messages/messages.module.js';
import { OrgsModule } from './modules/orgs/orgs.module.js';
import { PayPeriodsModule } from './modules/pay-periods/pay-periods.module.js';
import { PayRulesModule } from './modules/pay-rules/pay-rules.module.js';
import { PushModule } from './modules/push/push.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { TenancyModule } from './modules/tenancy/tenancy.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    AuthModule, // global JwtAuthGuard: who is calling
    TenancyModule, // global TenancyInterceptor: which org, what role, one transaction
    OrgsModule,
    CoverageModule,
    PushModule,
    IdempotencyModule,
    InvitesModule,
    LocationsModule,
    JobRolesModule,
    EmployeesModule,
    SchedulingModule,
    MessagesModule,
    PayRulesModule, // versioned pay rules (W6)
    PayPeriodsModule, // pay periods, approval, payroll (W6)
    WebhooksModule, // provider delivery reports, signature-verified
    AttendanceModule,
    AutofillModule, // clock-in/out: geofenced, idempotent
    RealtimeModule, // sockets: a change on one screen reaches the others
    HealthModule,
  ],
})
export class AppModule {}
