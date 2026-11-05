import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { DatabaseModule } from '../../database/database.module.js';
import { OrgsModule } from '../orgs/orgs.module.js';
import { TenancyInterceptor } from './tenancy.interceptor.js';

@Module({
  imports: [DatabaseModule, OrgsModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenancyInterceptor }],
})
export class TenancyModule {}
