import { describe, expect, it, vi } from 'vitest';

import {
  inRequestScope,
  memoizeInRequest,
  RequestScopeMiddleware,
  runInRequestScope,
  runOutsideRequestScope,
} from './request-scope';

describe('request-scope memo', () => {
  it('runs the lookup every time outside a request (no store, nothing cached)', async () => {
    const lookup = vi.fn().mockResolvedValue('value');

    await memoizeInRequest('key', lookup);
    await memoizeInRequest('key', lookup);

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('runs a lookup once per key within one request', async () => {
    const lookup = vi.fn().mockResolvedValue('value');

    await runInRequestScope(async () => {
      const [first, second] = await Promise.all([
        memoizeInRequest('key', lookup),
        memoizeInRequest('key', lookup),
      ]);
      expect([first, second]).toEqual(['value', 'value']);
    });

    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps different keys apart within one request', async () => {
    const a = vi.fn().mockResolvedValue('a');
    const b = vi.fn().mockResolvedValue('b');

    await runInRequestScope(async () => {
      expect(await memoizeInRequest('user-a', a)).toBe('a');
      expect(await memoizeInRequest('user-b', b)).toBe('b');
    });
  });

  it('never shares an entry between two requests', async () => {
    const lookup = vi.fn().mockResolvedValue('value');

    await runInRequestScope(() => memoizeInRequest('key', lookup));
    await runInRequestScope(() => memoizeInRequest('key', lookup));

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed lookup', async () => {
    const lookup = vi
      .fn()
      .mockRejectedValueOnce(new Error('database down'))
      .mockResolvedValueOnce('value');

    await runInRequestScope(async () => {
      await expect(memoizeInRequest('key', lookup)).rejects.toThrow('database down');
      await expect(memoizeInRequest('key', lookup)).resolves.toBe('value');
    });

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('opens a fresh store for each request through the middleware', async () => {
    const middleware = new RequestScopeMiddleware();
    const lookup = vi.fn().mockResolvedValue('value');
    const handle = (): Promise<void> =>
      new Promise((done) => {
        middleware.use({}, {}, () => {
          void memoizeInRequest('key', lookup)
            .then(() => memoizeInRequest('key', lookup))
            .then(() => done());
        });
      });

    await handle();
    await handle();

    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe('request-scope isolation (audit F5, #24)', () => {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));

  it('keeps two interleaved concurrent requests apart', async () => {
    const seen: string[] = [];
    const request = (user: string) =>
      runInRequestScope(async () => {
        await memoizeInRequest('hospital-context', () => Promise.resolve(user));
        await tick(); // the other request runs here
        seen.push(await memoizeInRequest('hospital-context', () => Promise.resolve('LEAK')));
      });

    await Promise.all([request('hospital-a'), request('hospital-b')]);

    expect(seen.sort()).toEqual(['hospital-a', 'hospital-b']);
  });

  it('proves the hazard: a plain timer started in a request carries its store', async () => {
    const observed = await runInRequestScope(async () => {
      await memoizeInRequest('key', () => Promise.resolve('request value'));
      return new Promise<string>((resolve) => {
        setTimeout(() => {
          void memoizeInRequest('key', () => Promise.resolve('fresh')).then(resolve);
        }, 1);
      });
    });

    expect(observed).toBe('request value');
  });

  it('runs background work started inside a request with no store', async () => {
    const result = await runInRequestScope(async () => {
      await memoizeInRequest('key', () => Promise.resolve('request value'));
      expect(inRequestScope()).toBe(true);

      return runOutsideRequestScope(
        () =>
          new Promise<{ scoped: boolean; value: string }>((resolve) => {
            setTimeout(() => {
              void memoizeInRequest('key', () => Promise.resolve('fresh')).then((value) =>
                resolve({ scoped: inRequestScope(), value }),
              );
            }, 1);
          }),
      );
    });

    expect(result).toEqual({ scoped: false, value: 'fresh' });
  });

  it('does not cache anything for detached work: every lookup runs', async () => {
    const lookup = vi.fn().mockResolvedValue('value');

    await runInRequestScope(() =>
      runOutsideRequestScope(async () => {
        await memoizeInRequest('key', lookup);
        await memoizeInRequest('key', lookup);
      }),
    );

    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('keeps a retry after a failure outside the store too', async () => {
    const scopes: boolean[] = [];
    const attempt = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => {
        scopes.push(inRequestScope());
        return Promise.reject(new Error('first attempt failed'));
      })
      .mockImplementationOnce(() => {
        scopes.push(inRequestScope());
        return Promise.resolve('ok');
      });

    await runInRequestScope(() =>
      runOutsideRequestScope(async () => {
        await attempt().catch(async () => {
          await tick();
          await attempt();
        });
      }),
    );

    expect(scopes).toEqual([false, false]);
  });

  it('leaves the request store intact for the request itself', () => {
    runInRequestScope(() => {
      expect(runOutsideRequestScope(() => inRequestScope())).toBe(false);
      expect(inRequestScope()).toBe(true);
    });
    expect(inRequestScope()).toBe(false);
  });
});
