import { Module } from '@nestjs/common';

import { MetricsRegistry } from './metrics.registry';

/** In-process metrics (M38.1). See `metrics.registry.ts`. */
@Module({
  providers: [MetricsRegistry],
  exports: [MetricsRegistry],
})
export class MetricsKernelModule {}
