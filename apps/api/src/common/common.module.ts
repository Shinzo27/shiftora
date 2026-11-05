import { Global, Module } from '@nestjs/common';

import { CLOCK, systemClock } from './clock.js';

/** App-wide providers every module may inject without importing anything. */
@Global()
@Module({
  providers: [{ provide: CLOCK, useValue: systemClock }],
  exports: [CLOCK],
})
export class CommonModule {}
