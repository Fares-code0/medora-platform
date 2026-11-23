import { describe, expect, it, vi } from 'vitest';

import { memoizeInRequest, RequestScopeMiddleware, runInRequestScope } from './request-scope';

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
