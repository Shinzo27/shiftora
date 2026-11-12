import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { RealtimeService } from './realtime.service.js';
import { ScheduleGateway } from './schedule.gateway.js';

/** Live board updates: the gateway holds the sockets, RealtimeService is what services call. */
@Module({
  imports: [DatabaseModule, AuthModule, OrgsModule],
  providers: [ScheduleGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
