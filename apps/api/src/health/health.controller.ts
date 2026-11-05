import { Controller, Get, Inject, Res } from '@nestjs/common';
import { pingDatabase, type DatabaseConnection } from '@shiftora/db';
import type { FastifyReply } from 'fastify';

import { DATABASE } from '../database/database.module.js';
import { Public } from '../modules/auth/public.decorator.js';

interface HealthStatus {
  status: 'ok' | 'error';
  checks?: { database: 'up' | 'down' };
}

/**
 * Public, unauthenticated probes for the hosting platform.
 *   live:  the process is up (restart it if not)
 *   ready: it can serve traffic, i.e. the database answers (stop routing to it if not)
 * Both keep the same body shape; "not ready" is a 503, not an error problem.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  @Get('live')
  live(): HealthStatus {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthStatus> {
    try {
      await pingDatabase(this.database.db);
      return { status: 'ok', checks: { database: 'up' } };
    } catch {
      void reply.status(503);
      return { status: 'error', checks: { database: 'down' } };
    }
  }
}
