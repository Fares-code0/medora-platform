import { afterEach, describe, expect, it } from 'vitest';

import type { ConfigService } from '../../../config';

import { RedisHealthIndicator } from './redis.indicator';

/**
 * Against a real server: the suite's `REDIS_URL` (the permission cache and
 * the rate-limit specs already require it), and a port nothing listens on.
 */
const live: RedisHealthIndicator[] = [];

function indicatorFor(redisUrl: string): RedisHealthIndicator {
  const indicator = new RedisHealthIndicator({ redisUrl } as ConfigService);
  live.push(indicator);
  return indicator;
}

async function settle(indicator: RedisHealthIndicator, want: 'up' | 'down'): Promise<string> {
  let status = await indicator.check();
  for (let attempt = 0; status !== want && attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    status = await indicator.check();
  }
  return status;
}

afterEach(() => {
  for (const indicator of live.splice(0)) indicator.onModuleDestroy();
});

describe('RedisHealthIndicator', () => {
  it('is up against the configured server', async () => {
    const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

    expect(await settle(indicatorFor(url), 'up')).toBe('up');
  });

  it('is down, promptly, when nothing answers', async () => {
    const started = Date.now();

    expect(await indicatorFor('redis://127.0.0.1:6390').check()).toBe('down');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
