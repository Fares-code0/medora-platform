import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  HEALTH_INDICATORS,
  type HealthIndicator,
  type HealthReport,
  SERVICE_KEYS,
  type ServiceKey,
  type ServiceStatus,
} from './health.types';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[]) {}

  /**
   * Liveness. Indicators run in parallel — a health check that probes
   * four dependencies serially is itself a latency problem, and this
   * endpoint is polled by load balancers and the admin dashboard.
   *
   * An indicator that throws reports `down` rather than propagating: the
   * point of a health endpoint is to answer even when things are broken.
   */
  async check(): Promise<HealthReport> {
    const services = defaultServices();

    const results = await Promise.all(
      this.indicators.map(async (indicator) => {
        try {
          return { key: indicator.key, status: await withTimeout(indicator.check()) };
        } catch (error) {
          this.logger.warn({ err: error, service: indicator.key }, 'Health indicator threw');
          return { key: indicator.key, status: 'down' as ServiceStatus };
        }
      }),
    );

    for (const { key, status } of results) {
      services[key] = status;
    }

    // `unconfigured` is not a failure — an unwired dependency cannot be
    // unhealthy. Only a real `down` degrades the overall status.
    const status = Object.values(services).includes('down') ? 'degraded' : 'ok';

    return { status, services };
  }

  /**
   * Readiness. Distinct from liveness: an orchestrator uses this to
   * decide whether to route traffic here, so a degraded dependency means
   * not ready, while liveness stays true (restarting would not help).
   */
  async ready(): Promise<HealthReport> {
    return this.check();
  }
}

/**
 * The longest one indicator may hold the response (ms). A dependency that
 * accepts a connection and then never answers would otherwise hang the
 * endpoint whose job is to say it is broken; past this it is `down`.
 */
export const INDICATOR_TIMEOUT_MS = 3_000;

function withTimeout(check: Promise<ServiceStatus>): Promise<ServiceStatus> {
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Health indicator timed out')), INDICATOR_TIMEOUT_MS);
  });

  return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
}

function defaultServices(): Record<ServiceKey, ServiceStatus> {
  return Object.fromEntries(SERVICE_KEYS.map((key) => [key, 'unconfigured'])) as Record<
    ServiceKey,
    ServiceStatus
  >;
}
