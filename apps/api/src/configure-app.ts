import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ProblemDetailsFilter } from './common/problem-details.filter.js';

export const API_PREFIX = 'api/v1';

export interface HttpOptions {
  /** Browser origin allowed to call the API with cookies (the web app). */
  webOrigin: string;
}

/** App-wide HTTP setup, shared by main.ts and tests so they behave the same. */
export async function configureApp(
  app: NestFastifyApplication,
  options: HttpOptions,
): Promise<void> {
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  app.enableCors({ origin: options.webOrigin, credentials: true });
  app.useGlobalFilters(new ProblemDetailsFilter());
  await app.register(fastifyCookie);
}
