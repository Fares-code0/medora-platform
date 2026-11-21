import { describe, expect, it, vi } from 'vitest';

import { CachedProbe } from './cached-probe';

describe('CachedProbe', () => {
  it('reuses an answer inside the TTL and probes again after it', async () => {
    let clock = 0;
    const probe = vi.fn().mockResolvedValueOnce('up').mockResolvedValueOnce('down');
    const cached = new CachedProbe(probe, 1_000, () => clock);

    expect(await cached.check()).toBe('up');
    clock = 999;
    expect(await cached.check()).toBe('up');
    expect(probe).toHaveBeenCalledTimes(1);

    clock = 1_000;
    expect(await cached.check()).toBe('down');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('shares one probe between concurrent callers', async () => {
    let finish: (status: 'up') => void = () => undefined;
    const probe = vi.fn(() => new Promise<'up'>((resolve) => (finish = resolve)));
    const cached = new CachedProbe(probe);

    const both = Promise.all([cached.check(), cached.check(), cached.check()]);
    finish('up');

    expect(await both).toEqual(['up', 'up', 'up']);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('caches a down as well, so an outage is not probed on every poll', async () => {
    const probe = vi.fn().mockResolvedValue('down');
    const cached = new CachedProbe(probe, 1_000, () => 0);

    await cached.check();
    await cached.check();

    expect(probe).toHaveBeenCalledTimes(1);
  });
});
