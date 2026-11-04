import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { pingDatabase, type DatabaseConnection } from '@shiftora/db';

import { DATABASE } from '../database/database.module.js';

/**
 * Public, unauthenticated probes for the hosting platform.
 *   live:  the process is up (restart it if not)
 *   ready: it can serve traffic, i.e. the database answers (stop routing to it if not)
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await pingDatabase(this.database.db);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
