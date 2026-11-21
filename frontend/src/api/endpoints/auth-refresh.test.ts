import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';

import { httpAuthService } from './auth';

/**
 * The refresh path — F-07 / backend M6.3.
 *
 * `client.test.ts` already proves `ApiClient` refreshes once and replays.
 * What is proved here is the half that only exists once a *real* refresh
 * is wired to it:
 *
 *  · a refresh that fails must resolve to "no session", not hang;
 *  · concurrent 401s must still spend exactly one refresh, because the
 *    backend rotates the refresh token on every use and revokes the whole
 *    session family when it sees the previous one replayed. A second
 *    concurrent refresh does not just waste a request — it logs the user
 *    out. Verified against the live server: refreshing with a rotated-out
 *    token 401s *and* kills the token that replaced it.
 */

let fetchMock: ReturnType<typeof vi.fn>;

function jsonOnce(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const REFRESHED = {
  data: {
    user: {
      id: 'usr_5q3Q3ItSSmfJiUJn',
      name: 'Dr. Seam Tester',
      email: 'seam.tester@medora.health',
      role: 'doctor',
      permissions: ['patients.view'],
    },
    accessToken: 'rotated-access-token',
    expiresIn: 900,
  },
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-correlation-id' });
  }
  apiClient.setAccessToken(null);
  apiClient.setUnauthorizedHandler(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  apiClient.setAccessToken(null);
  apiClient.setUnauthorizedHandler(null);
});

describe('httpAuthService.restore', () => {
  it('exchanges the httpOnly cookie for a fresh access token', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonOnce(REFRESHED)));

    const session = await httpAuthService.restore();

    expect(session?.accessToken).toBe('rotated-access-token');
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    expect(url.pathname).toBe('/api/v1/auth/refresh');
    // The cookie is the credential, so the request must be credentialed.
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).credentials).toBe('include');
  });

  it('reports "no session" for a 401 rather than throwing at the boot screen', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonOnce({ message: 'Session expired', code: 'unauthorized' }, 401)),
    );

    await expect(httpAuthService.restore()).resolves.toBeNull();
  });

  it('collapses concurrent restores into one rotation', async () => {
    // Not an optimization. The backend retires the presented token and
    // revokes the family when it sees the retired one again, so a second
    // concurrent restore logs the user out. React StrictMode double-invokes
    // the provider's boot effect, which is exactly this — observed against
    // the live API as two `POST /auth/refresh` calls per page load.
    fetchMock.mockImplementation(() => Promise.resolve(jsonOnce(REFRESHED)));

    const [a, b, c] = await Promise.all([
      httpAuthService.restore(),
      httpAuthService.restore(),
      httpAuthService.restore(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('starts a fresh rotation once the previous one has settled', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonOnce(REFRESHED)));

    await httpAuthService.restore();
    await httpAuthService.restore();

    // Sequential calls are genuinely separate refreshes — the guard must
    // not latch and serve a stale session forever.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not deadlock when the refresh itself 401s', async () => {
    // The regression this guards: if the refresh call went through the
    // same ApiClient, its own 401 would re-enter the single-flight helper,
    // find the promise it is itself the body of, and await it forever.
    // A hung boot screen is much worse than a logout, and no timeout
    // would ever fire — so the assertion is simply that this resolves.
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonOnce({ message: 'Session expired', code: 'unauthorized' }, 401)),
    );
    apiClient.setUnauthorizedHandler(async () => {
      const session = await httpAuthService.restore();
      return session?.accessToken ?? null;
    });

    const settled = await Promise.race([
      httpAuthService.restore().then(() => 'resolved' as const),
      new Promise<'hung'>((resolve) => {
        setTimeout(() => resolve('hung'), 1_000);
      }),
    ]);

    expect(settled).toBe('resolved');
  });
});

describe('the 401 → refresh → replay path, wired to the real service', () => {
  it('spends exactly one refresh for concurrent 401s and replays both', async () => {
    // Two clinical requests 401 together; the refresh succeeds; both replay.
    let refreshCalls = 0;
    fetchMock.mockImplementation((url: URL) => {
      if (url.pathname.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(jsonOnce(REFRESHED));
      }
      // 401 until a token is set, then succeed — the shape a genuinely
      // expired access token produces.
      return Promise.resolve(
        refreshCalls === 0
          ? jsonOnce({ message: 'Unauthorized', code: 'unauthorized' }, 401)
          : jsonOnce({ ok: true }),
      );
    });

    apiClient.setUnauthorizedHandler(async () => {
      const session = await httpAuthService.restore();
      return session?.accessToken ?? null;
    });

    const [a, b] = await Promise.all([
      apiClient.get('/patients'),
      apiClient.get('/appointments'),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    // The single-flight guarantee: one rotation, not two. Two would
    // present the retired token and revoke the session family.
    expect(refreshCalls).toBe(1);
  });

  it('replays the retried request with the rotated token', async () => {
    let refreshed = false;
    fetchMock.mockImplementation((url: URL) => {
      if (url.pathname.endsWith('/auth/refresh')) {
        refreshed = true;
        return Promise.resolve(jsonOnce(REFRESHED));
      }
      return Promise.resolve(
        refreshed
          ? jsonOnce({ id: 'p1' })
          : jsonOnce({ message: 'Unauthorized', code: 'unauthorized' }, 401),
      );
    });

    apiClient.setUnauthorizedHandler(async () => {
      const session = await httpAuthService.restore();
      return session?.accessToken ?? null;
    });

    await expect(apiClient.get('/patients/p1')).resolves.toEqual({ id: 'p1' });

    const headers = (fetchMock.mock.calls.at(-1)?.[1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(headers['Authorization']).toBe('Bearer rotated-access-token');
  });
});
