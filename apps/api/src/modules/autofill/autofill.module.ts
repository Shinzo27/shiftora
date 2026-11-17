import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module.js';
import { LocationsModule } from '../locations/locations.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AutofillController } from './autofill.controller.js';
import { AutofillService } from './autofill.service.js';

@Module({
  imports: [DatabaseModule, LocationsModule, OutboxModule, SchedulingModule],
  controllers: [AutofillController],
  providers: [AutofillService],
})
export class AutofillModule {}
