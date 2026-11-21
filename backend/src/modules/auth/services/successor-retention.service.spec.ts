import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConfigService } from '../../../config';

import type { SessionService } from './session.service';
import { SuccessorRetentionService } from './successor-retention.service';

/**
 * RA-045.2's fallback, with the sweep stubbed and the timer faked, so the
 * schedule is driven exactly rather than waited for. The e2e spec
 * (`auth-refresh`) runs the real sweep against PostgreSQL.
 */
function configWith(intervalSeconds: number, jobsEnabled: boolean): ConfigService {
  return {
    env: { REFRESH_SUCCESSOR_SWEEP_INTERVAL_SECONDS: intervalSeconds, JOBS_ENABLED: jobsEnabled },
    jobsEnabled,
  } as unknown as ConfigService;
}

function stubSessions(impl: () => Promise<number> = () => Promise.resolve(0)) {
  const clearLapsedSuccessors = vi.fn(impl);
  return {
    sessions: { clearLapsedSuccessors } as unknown as SessionService,
    clearLapsedSuccessors,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SuccessorRetentionService (ADR-045, RA-045.2)', () => {
  it.each([false, true])(
    'sweeps once at bootstrap, then every interval — whether or not jobs are enabled (%s)',
    async (jobsEnabled) => {
      const { sessions, clearLapsedSuccessors } = stubSessions(() => Promise.resolve(2));
      const service = new SuccessorRetentionService(sessions, configWith(30, jobsEnabled));

      await service.onApplicationBootstrap();
      expect(clearLapsedSuccessors).toHaveBeenCalledTimes(1);
      expect(service.scheduled).toBe(true);

      await vi.advanceTimersByTimeAsync(29_999);
      expect(clearLapsedSuccessors).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(clearLapsedSuccessors).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(clearLapsedSuccessors).toHaveBeenCalledTimes(4);

      await service.onModuleDestroy();
    },
  );

  it('uses the configured interval', async () => {
    const { sessions, clearLapsedSuccessors } = stubSessions();
    const service = new SuccessorRetentionService(sessions, configWith(5, false));

    await service.onApplicationBootstrap();
    expect(service.intervalMs).toBe(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(clearLapsedSuccessors).toHaveBeenCalledTimes(2);

    await service.onModuleDestroy();
  });

  it('logs a failed sweep and keeps going — it never rejects or stops the timer', async () => {
    let calls = 0;
    const { sessions, clearLapsedSuccessors } = stubSessions(() => {
      calls++;
      return calls === 1 ? Promise.reject(new Error('database unreachable')) : Promise.resolve(1);
    });
    const service = new SuccessorRetentionService(sessions, configWith(30, false));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
    expect(service.scheduled).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(clearLapsedSuccessors).toHaveBeenCalledTimes(2);
    expect(await service.tick()).toBe(1);

    await service.onModuleDestroy();
  });

  it('skips a tick while the previous run is still going, instead of stacking them', async () => {
    let finish!: (cleared: number) => void;
    const { sessions, clearLapsedSuccessors } = stubSessions(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    const service = new SuccessorRetentionService(sessions, configWith(30, false));

    const first = service.tick();
    expect(await service.tick()).toBe(0);
    expect(clearLapsedSuccessors).toHaveBeenCalledTimes(1);
    finish(3);
    expect(await first).toBe(3);

    await service.onModuleDestroy();
  });

  it('shutdown clears the timer, waits for the run in flight, and starts nothing after', async () => {
    let finish!: (cleared: number) => void;
    let calls = 0;
    const { sessions, clearLapsedSuccessors } = stubSessions(() => {
      calls++;
      return calls === 1
        ? Promise.resolve(0)
        : new Promise<number>((resolve) => {
            finish = resolve;
          });
    });
    const service = new SuccessorRetentionService(sessions, configWith(30, false));
    await service.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(clearLapsedSuccessors).toHaveBeenCalledTimes(2);

    let destroyed = false;
    const destroy = service.onModuleDestroy().then(() => {
      destroyed = true;
    });
    expect(service.scheduled).toBe(false);
    await Promise.resolve();
    expect(destroyed).toBe(false);
    finish(1);
    await destroy;
    expect(destroyed).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(await service.tick()).toBe(0);
    expect(clearLapsedSuccessors).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a service destroyed before bootstrap never sweeps nor arms a timer', async () => {
    const { sessions, clearLapsedSuccessors } = stubSessions();
    const service = new SuccessorRetentionService(sessions, configWith(30, false));

    await service.onModuleDestroy();
    await service.onApplicationBootstrap();

    expect(clearLapsedSuccessors).not.toHaveBeenCalled();
    expect(service.scheduled).toBe(false);
  });
});
