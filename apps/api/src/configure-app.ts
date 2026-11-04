import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** App-wide HTTP setup, shared by main.ts and tests so they behave the same. */
export function configureApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
}
