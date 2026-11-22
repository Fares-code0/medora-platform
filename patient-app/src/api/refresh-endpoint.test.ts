import { apiClient } from './client';
import { authEndpoints, REFRESH_TIMEOUT_MS } from './endpoints/auth';

const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('POST /auth/refresh', () => {
  it('gives up sooner than the default, and never refreshes itself', async () => {
    const post = jest.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        accessToken: 'a',
        refreshToken: 'r',
        user: { id: 'u', email: 'sara@example.com' },
      },
    });

    await authEndpoints.refresh({ refreshToken: 'r-0' });

    // The cold start waits on this behind the boot screen; a black-holed
    // network must reach `unconfirmed` well before the 30 s default.
    expect(REFRESH_TIMEOUT_MS).toBeLessThan(30_000);
    expect(post).toHaveBeenCalledWith(
      'auth/refresh',
      { refreshToken: 'r-0' },
      { skipRefresh: true, timeoutMs: REFRESH_TIMEOUT_MS },
    );
  });

  it('still reads a timeout as a timeout, which keeps the session', async () => {
    global.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    jest.useFakeTimers();
    try {
      const pending = authEndpoints.refresh({ refreshToken: 'r-0' });
      const outcome = pending.then(
        () => null,
        (error: unknown) => error,
      );
      jest.advanceTimersByTime(REFRESH_TIMEOUT_MS);
      await expect(outcome).resolves.toMatchObject({ kind: 'timeout' });
    } finally {
      jest.useRealTimers();
    }
  });
});
