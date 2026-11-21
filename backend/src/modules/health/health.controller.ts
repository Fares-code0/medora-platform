import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';

import { Public } from '../../common/auth/public.decorator';
import { AppException } from '../../common/errors/app.exception';

import { HealthService } from './health.service';
import type { HealthReport } from './health.types';

/**
 * `GET /api/v1/health` and `/ready` (API §20.1–20.2).
 *
 * Public — a probe that requires a token cannot report that auth is
 * down, and an orchestrator has no credentials to offer. `@Public()` is
 * on the controller because both routes are probes; M6.2 made the
 * default the other way round, so this marker is what keeps the
 * liveness check reachable.
 *
 * The decorator lives in `common/` rather than in the auth module: M2.2's
 * zone 1 forbids health from importing a sibling.
 */
@Public()
@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  async getHealth(): Promise<HealthReport> {
    return this.health.check();
  }

  /**
   * Readiness returns 503 when a dependency is down, so an orchestrator
   * stops routing traffic here. Liveness stays 200 in the same state —
   * the process is fine; its dependency is not, and a restart would not
   * fix that.
   */
  @Get('ready')
  async getReady(): Promise<HealthReport> {
    const report = await this.health.ready();

    if (report.status !== 'ok') {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'One or more dependencies are unavailable',
        code: 'service_unavailable',
        detail: Object.entries(report.services)
          .filter(([, status]) => status === 'down')
          .map(([service]) => service)
          .join(', '),
      });
    }

    return report;
  }
}
