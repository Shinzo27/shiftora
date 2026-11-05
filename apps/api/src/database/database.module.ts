import { Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabaseConnection, type DatabaseConnection } from '@shiftora/db';

import { AppConfig } from '../config/app-config.js';
import { RequestContext } from './request-context.js';

/** Injection token for the shared database connection (pool + Drizzle client). */
export const DATABASE = Symbol('DATABASE');

@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): DatabaseConnection => {
        const logger = new Logger('Database');
        return createDatabaseConnection(config.databaseUrl, {
          onIdleError: (error) => logger.error(`Idle connection error: ${error.message}`),
        });
      },
    },
    RequestContext,
  ],
  exports: [DATABASE, RequestContext],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: DatabaseConnection) {}

  // Close pooled connections on SIGTERM so in-flight queries finish cleanly on deploys.
  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
