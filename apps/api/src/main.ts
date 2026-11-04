import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { AppConfig } from './config/app-config.js';
import { loadEnvFile } from './config/load-env-file.js';
import { configureApp } from './configure-app.js';

loadEnvFile();

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
configureApp(app);

const config = app.get(AppConfig);
await app.listen(config.port, config.host);
