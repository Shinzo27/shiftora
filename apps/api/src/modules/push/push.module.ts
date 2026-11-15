import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { PushController } from './push.controller.js';
import { PushSubscriptionsRepository } from './push-subscriptions.repository.js';

@Module({
  // EmployeesModule provides the lookup from "who is calling" to "which employee row".
  imports: [DatabaseModule, EmployeesModule],
  controllers: [PushController],
  providers: [PushSubscriptionsRepository],
  exports: [PushSubscriptionsRepository],
})
export class PushModule {}
