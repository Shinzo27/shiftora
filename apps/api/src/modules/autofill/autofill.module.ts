import { Module } from '@nestjs/common';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';

import { DatabaseModule } from '../../database/database.module.js';
import { RATE_LIMIT_STORAGE, RateLimitModule } from '../../common/rate-limit/rate-limit.module.js';
import { trackerByUser } from '../../common/rate-limit/trackers.js';
import { AuditModule } from '../audit/audit.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AutofillController } from './autofill.controller.js';
import { AutofillService } from './autofill.service.js';

@Module({
  imports: [
    DatabaseModule,
    LocationsModule,
    OutboxModule,
    SchedulingModule,
    AuditModule,
    // Six a minute per manager: enough to try the week a few times, not enough to make the
    // worker grind on a loop. Counted per person, because a whole clinic shares one address.
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage: ThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 6 }],
        storage,
        getTracker: trackerByUser,
      }),
    }),
  ],
  controllers: [AutofillController],
  providers: [AutofillService],
})
export class AutofillModule {}
