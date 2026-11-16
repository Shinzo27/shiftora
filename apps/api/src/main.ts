import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { loadEnvFile } from './config/load-env-file.js';
import { configureApp } from './configure-app.js';

loadEnvFile();

// rawBody: provider webhooks are verified against the exact bytes that were signed.
const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  rawBody: true,
});
// Socket.IO rides on the same HTTP server; without this a Fastify app has no ws adapter.
app.useWebSocketAdapter(new IoAdapter(app));
const config = app.get(AppConfig);
await configureApp(app, config);

await app.listen(config.port, config.host);
