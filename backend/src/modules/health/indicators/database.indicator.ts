import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { HealthIndicator, ServiceKey, ServiceStatus } from '../health.types';

/**
 * The database probe M1.4 left a slot for (RM M4).
 *
 * `HealthModule` registered an empty indicator array with the comment
 * "M4 adds the database probe". This is that probe, and adding it
 * changed nothing about the response shape — which was the point of
 * making indicators pluggable.
 *
 * `db` stops reporting `unconfigured` and starts reporting `up` or
 * `down`, so the admin System Health card (API §18.15) now distinguishes
 * a database that is broken from one that was never wired.
 *
 * Lives in the health module rather than beside `PrismaService` because
 * the shared kernel may not import a domain module (ADR-019 §5) — and
 * `HealthIndicator` is the health module's interface. The dependency
 * points the legal way round: health imports the kernel's public API.
 */
@Injectable()
export class DatabaseHealthIndicator implements HealthIndicator {
  readonly key: ServiceKey = 'db';

  private readonly logger = new Logger(DatabaseHealthIndicator.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<ServiceStatus> {
    try {
      await this.prisma.ping();
      return 'up';
    } catch (error) {
      // Swallowed and reported as `down`: a health endpoint that throws
      // when a dependency is broken cannot report that it is broken.
      // The error is logged once here so the reason is recoverable.
      this.logger.warn({ err: error }, 'Database health check failed');
      return 'down';
    }
  }
}
