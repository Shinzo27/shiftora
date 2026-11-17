import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { JobEventsService } from './job-events.service.js';
import { RealtimeService } from './realtime.service.js';
import { ScheduleGateway } from './schedule.gateway.js';

/** Live board updates: the gateway holds the sockets, RealtimeService is what services call. */
@Module({
  imports: [DatabaseModule, AuthModule, OrgsModule],
  // JobEventsService runs itself; only this module needs it.
  providers: [ScheduleGateway, RealtimeService, JobEventsService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
