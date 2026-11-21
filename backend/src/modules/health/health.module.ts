import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { MetaController } from './meta.controller';
import { MetricsController } from './metrics.controller';
import { HealthService } from './health.service';
import { HEALTH_INDICATORS, type HealthIndicator } from './health.types';
import { DatabaseHealthIndicator } from './indicators/database.indicator';
import { MailHealthIndicator } from './indicators/mail.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { StorageHealthIndicator } from './indicators/storage.indicator';
import { MetaService } from './meta.service';

/**
 * Health module (API §20).
 *
 * Each milestone that adds a dependency pushes its probe into this
 * provider — **M4 the database (done)**, M25 storage, M31 Redis, M19
 * mail — and the response shape does not change when it does. Anything
 * with no probe registered still reports `unconfigured`, which stays
 * deliberately distinct from `down` (ADR-016).
 */
@Module({
  controllers: [HealthController, MetaController, MetricsController],
  providers: [
    HealthService,
    MetaService,
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    StorageHealthIndicator,
    MailHealthIndicator,
    {
      provide: HEALTH_INDICATORS,
      inject: [
        DatabaseHealthIndicator,
        RedisHealthIndicator,
        StorageHealthIndicator,
        MailHealthIndicator,
      ],
      // ADR-016 §4's list in its own order: M4 the database, M31 Redis,
      // M25 storage, M19 mail. `ai` stays `unconfigured` — no provider is
      // bound behind `AI_GATEWAY` (Multi-Hospital I6 holds it to G-5).
      useFactory: (...indicators: HealthIndicator[]): readonly HealthIndicator[] => indicators,
    },
  ],
  exports: [HealthService],
})
export class HealthModule {}
