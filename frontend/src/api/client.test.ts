import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient, UPLOAD_TIMEOUT_MS } from './client';

/**
 * ApiClient contract — FRONTEND_ARCHITECTURE.md §10.1/§10.2.
 * Covers the behaviours that are easy to break and expensive to lose:
 * the auth header, param serialization, error normalization, and the
 * single-flight 401 → refresh → replay path.
 */

const BASE = 'https://api.test/v1';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

/**
 * A `Response` body can only be read once, so every fetch call must get a
 * fresh instance — `mockResolvedValue` would hand the same one back twice.
 */
function alwaysJson(body: unknown, init: ResponseInit = {}): () => Promise<Response> {
  return () => Promise.resolve(jsonResponse(body, init));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal('crypto', { randomUUID: () => 'test-correlation-id' });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): { url: URL; init: RequestInit } {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was never called');
  return { url: call[0] as URL, init: call[1] as RequestInit };
}

function headerOf(init: RequestInit, key: string): string | undefined {
  return (init.headers as Record<string, string>)[key];
}

describe('ApiClient', () => {
  it('resolves paths against the base URL without dropping the base path segment', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await new ApiClient(BASE).get('/patients');

    expect(lastRequest().url.toString()).toBe('https://api.test/v1/patients');
  });

  it('omits the Authorization header until a token is set', async () => {
    fetchMock.mockImplementation(alwaysJson({ ok: true }));
    const client = new ApiClient(BASE);

    await client.get('/patients');
    expect(headerOf(lastRequest().init, 'Authorization')).toBeUndefined();

    client.setAccessToken('token-abc');
    await client.get('/patients');
    expect(headerOf(lastRequest().init, 'Authorization')).toBe('Bearer token-abc');
  });

  it('serializes only non-empty scalar params', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    await new ApiClient(BASE).get('/patients', {
      q: 'chen',
      page: 2,
      critical: false,
      empty: '',
      missing: undefined,
      nested: { a: 1 },
    });

    const { url } = lastRequest();
    expect(url.searchParams.get('q')).toBe('chen');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('critical')).toBe('false');
    expect(url.searchParams.has('empty')).toBe(false);
    expect(url.searchParams.has('missing')).toBe(false);
    expect(url.searchParams.has('nested')).toBe(false);
  });

  it('returns undefined for 204 responses instead of failing to parse a body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(new ApiClient(BASE).delete('/patients/1')).resolves.toBeUndefined();
  });

  it('turns a non-JSON success body into a normalized malformed_response, not a SyntaxError', async () => {
    // What an SPA host's catch-all rewrite answers a mistyped API base URL with.
    fetchMock.mockResolvedValue(
      new Response('<!doctype html><title>Medora</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );

    const failure = await new ApiClient(BASE).get('/patients').then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(SyntaxError);
    expect(failure).toMatchObject({ kind: 'server', code: 'malformed_response' });
    // The ref names no path, so no patient handle reaches an error report.
    expect(JSON.stringify(failure)).not.toContain('/patients');
  });

  it('reads an empty success body as undefined, the way it reads a 204', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));

    await expect(new ApiClient(BASE).post('/auth/logout')).resolves.toBeUndefined();
  });

  it('still parses an ordinary JSON success body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 'p1' } }));

    await expect(new ApiClient(BASE).get('/patients/p1')).resolves.toEqual({ data: { id: 'p1' } });
  });

  it('sends no body on a bare DELETE, and a JSON body when one is given', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = new ApiClient(BASE);

    await client.delete('/patients/1/emergency-contacts/ec-1');
    expect(lastRequest().init.body).toBeUndefined();
    expect(headerOf(lastRequest().init, 'Content-Type')).toBeUndefined();

    await client.delete('/patients/1/history/ev-1', { reason: 'Entered on the wrong chart' });
    expect(lastRequest().init.method).toBe('DELETE');
    expect(lastRequest().init.body).toBe(JSON.stringify({ reason: 'Entered on the wrong chart' }));
    expect(headerOf(lastRequest().init, 'Content-Type')).toBe('application/json');
  });

  it('sends a multipart body as it is, leaving the browser to set its boundary', async () => {
    fetchMock.mockImplementation(alwaysJson({ data: {} }));
    const client = new ApiClient(BASE);
    const form = new FormData();
    form.append('photo', new Blob(['png'], { type: 'image/png' }), 'photo.png');

    await client.put('/me/profile/photo', form);

    expect(lastRequest().init.method).toBe('PUT');
    expect(lastRequest().init.body).toBe(form);
    // A hand-set multipart Content-Type would lack the boundary.
    expect(headerOf(lastRequest().init, 'Content-Type')).toBeUndefined();
  });

  it('sends Idempotency-Key only when the caller gives one (M39.3)', async () => {
    fetchMock.mockImplementation(alwaysJson({ ok: true }));
    const client = new ApiClient(BASE);

    await client.post('/appointments', { a: 1 });
    expect(headerOf(lastRequest().init, 'Idempotency-Key')).toBeUndefined();

    await client.post('/appointments', { a: 1 }, { idempotencyKey: 'intent-1' });
    expect(headerOf(lastRequest().init, 'Idempotency-Key')).toBe('intent-1');
  });

  it('keeps the Idempotency-Key on the replay after a refresh, so a retried write cannot run twice', async () => {
    fetchMock
      .mockImplementationOnce(alwaysJson({ code: 'unauthorized' }, { status: 401 }))
      .mockImplementation(alwaysJson({ ok: true }));
    const client = new ApiClient(BASE);
    client.setUnauthorizedHandler(() => Promise.resolve('fresh-token'));

    await client.post('/prescriptions', { a: 1 }, { idempotencyKey: 'intent-2' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(headerOf(call[1] as RequestInit, 'Idempotency-Key')).toBe('intent-2');
    }
  });

  it('normalizes a fetch rejection into a network ApiError', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(new ApiClient(BASE).get('/patients')).rejects.toMatchObject({ kind: 'network' });
  });

  it('normalizes a 422 into a validation ApiError carrying field errors', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ fieldErrors: { email: ['Required'] } }, { status: 422 }),
    );

    await expect(new ApiClient(BASE).post('/patients', {})).rejects.toMatchObject({
      kind: 'validation',
      fieldErrors: { email: ['Required'] },
    });
  });

  it('throws an auth error on 401 when no refresh handler is registered', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, { status: 401 }));

    await expect(new ApiClient(BASE).get('/patients')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('refreshes once and replays the request after a 401', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }));

    const client = new ApiClient(BASE);
    const refresh = vi.fn(() => {
      client.setAccessToken('fresh-token');
      return Promise.resolve('fresh-token');
    });
    client.setUnauthorizedHandler(refresh);

    await expect(client.get('/patients/p1')).resolves.toEqual({ id: 'p1' });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(headerOf(lastRequest().init, 'Authorization')).toBe('Bearer fresh-token');
  });

  it('does not retry a second time when the replayed request also 401s', async () => {
    fetchMock.mockImplementation(alwaysJson({}, { status: 401 }));

    const client = new ApiClient(BASE);
    client.setUnauthorizedHandler(() => Promise.resolve('fresh-token'));

    await expect(client.get('/patients')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes on a 401 carrying the token-failure code `unauthorized`', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }));

    const client = new ApiClient(BASE);
    const refresh = vi.fn(() => Promise.resolve('fresh-token'));
    client.setUnauthorizedHandler(refresh);

    await expect(client.get('/patients/p1')).resolves.toEqual({ id: 'p1' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid_credentials', 'otp_invalid'])(
    'neither refreshes nor replays a 401 `%s` — a business rejection, not an expired token',
    async (code) => {
      fetchMock.mockImplementation(alwaysJson({ code, message: 'nope' }, { status: 401 }));

      const client = new ApiClient(BASE);
      const refresh = vi.fn(() => Promise.resolve('fresh-token'));
      client.setUnauthorizedHandler(refresh);

      await expect(
        client.post('/me/password', { currentPassword: 'wrong', newPassword: 'x' }),
      ).rejects.toMatchObject({ kind: 'auth', code });
      expect(refresh).not.toHaveBeenCalled();
      // The rejected POST reached the server exactly once.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects with the AbortError, not a network error, when the caller cancels', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const pending = new ApiClient(BASE).get('/patients', undefined, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts a POST on its signal too — the safety screen is a POST', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const pending = new ApiClient(BASE).post(
      '/prescriptions/safety-check',
      {},
      { signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not issue a request whose signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      new ApiClient(BASE).get('/patients', undefined, { signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** A fetch that never settles on its own — only its abort ends it. */
  function hangingFetch(): void {
    fetchMock.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
  }

  it.each(['put', 'patch', 'delete'] as const)(
    'takes the same RequestOptions on %s — signal and Idempotency-Key (D2)',
    async (verb) => {
      const client = new ApiClient(BASE);
      fetchMock.mockImplementation(alwaysJson({ ok: true }));

      await client[verb]('/things/1', { a: 1 }, { idempotencyKey: `intent-${verb}` });
      expect(headerOf(lastRequest().init, 'Idempotency-Key')).toBe(`intent-${verb}`);

      hangingFetch();
      const controller = new AbortController();
      const pending = client[verb]('/things/1', { a: 1 }, { signal: controller.signal });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    },
  );

  it('keeps a body-less DELETE body-less when options are given', async () => {
    fetchMock.mockImplementation(alwaysJson({ ok: true }));

    await new ApiClient(BASE).delete('/things/1', undefined, { idempotencyKey: 'intent-d' });

    expect(lastRequest().init.body).toBeUndefined();
    expect(headerOf(lastRequest().init, 'Content-Type')).toBeUndefined();
  });

  describe('timeouts (D2)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('ends a request at the 30 s default, as a network error', async () => {
      hangingFetch();
      const pending = new ApiClient(BASE).get('/patients');
      const outcome = expect(pending).rejects.toMatchObject({ kind: 'network' });

      await vi.advanceTimersByTimeAsync(30_000);

      await outcome;
    });

    it('honours a per-request timeout override', async () => {
      hangingFetch();
      let settled = false;
      const pending = new ApiClient(BASE)
        .post('/files', new FormData(), { timeoutMs: UPLOAD_TIMEOUT_MS })
        .finally(() => {
          settled = true;
        });
      const outcome = expect(pending).rejects.toMatchObject({ kind: 'network' });

      // Past the default, the upload is still running …
      await vi.advanceTimersByTimeAsync(60_000);
      expect(settled).toBe(false);

      // … and the longer budget still ends it, with the same error as before.
      await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 60_000);
      await outcome;
    });

    it('gives multipart uploads a budget a 10 MB body on a slow uplink fits', () => {
      // ~84 s at 1 Mbit/s for 10 MB alone; the default 30 s cannot carry it.
      expect(UPLOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(90_000);
    });
  });

  it('shares one refresh across concurrent 401s (single flight)', async () => {
    // Both initial requests 401; both replays succeed.
    fetchMock.mockImplementation(alwaysJson({}, { status: 401 }));

    const client = new ApiClient(BASE);
    let resolveRefresh: (token: string) => void = () => {};
    const refresh = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    client.setUnauthorizedHandler(refresh);

    const first = client.get('/a');
    const second = client.get('/b');
    await vi.waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });

    fetchMock.mockImplementation(alwaysJson({ ok: true }));
    resolveRefresh('fresh-token');

    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
