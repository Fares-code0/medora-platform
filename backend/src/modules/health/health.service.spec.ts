import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthService, INDICATOR_TIMEOUT_MS } from './health.service';
import type { HealthIndicator, ServiceKey, ServiceStatus } from './health.types';

function indicator(key: ServiceKey, check: () => Promise<ServiceStatus>): HealthIndicator {
  return { key, check };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HealthService', () => {
  it('reports every key, unconfigured where no indicator is bound', async () => {
    const report = await new HealthService([indicator('db', () => Promise.resolve('up'))]).check();

    expect(report).toEqual({
      status: 'ok',
      services: {
        db: 'up',
        redis: 'unconfigured',
        storage: 'unconfigured',
        mail: 'unconfigured',
        ai: 'unconfigured',
      },
    });
  });

  it('degrades on a real down, and only on a down', async () => {
    const service = new HealthService([
      indicator('db', () => Promise.resolve('up')),
      indicator('mail', () => Promise.resolve('down')),
      indicator('storage', () => Promise.resolve('unconfigured')),
    ]);

    const report = await service.check();

    expect(report.status).toBe('degraded');
    expect(report.services.mail).toBe('down');
  });

  it('reports a throwing indicator as down instead of failing the endpoint', async () => {
    const report = await new HealthService([
      indicator('redis', () => Promise.reject(new Error('boom'))),
    ]).check();

    expect(report.services.redis).toBe('down');
    expect(report.status).toBe('degraded');
  });

  it('reports a hung indicator as down once the timeout passes', async () => {
    vi.useFakeTimers();
    const service = new HealthService([
      indicator('db', () => Promise.resolve('up')),
      indicator('mail', () => new Promise<ServiceStatus>(() => undefined)),
    ]);

    const pending = service.check();
    await vi.advanceTimersByTimeAsync(INDICATOR_TIMEOUT_MS + 1);
    const report = await pending;

    expect(report.services).toMatchObject({ db: 'up', mail: 'down' });
  });
});
