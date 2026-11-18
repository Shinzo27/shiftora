import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { createLogger, PinoNestLogger } from './common/logging.js';
import { AppConfig } from './config/app-config.js';
import { loadEnvFile } from './config/load-env-file.js';
import { configureApp, fastifyOptions } from './configure-app.js';

loadEnvFile();

// JSON logs on stdout (W7 D5): Fastify and Nest's Logger both write through this one pino.
const logger = createLogger();
// rawBody: provider webhooks are verified against the exact bytes that were signed.
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(fastifyOptions(logger)),
  { rawBody: true, logger: new PinoNestLogger(logger) },
);
// Socket.IO rides on the same HTTP server; without this a Fastify app has no ws adapter.
app.useWebSocketAdapter(new IoAdapter(app));
const config = app.get(AppConfig);
await configureApp(app, config);

await app.listen(config.port, config.host);
