import { ResponseContractError } from '@/schemas/envelope';
import { isApiError, isTokenExpiryError } from '@/types/api';

import { ApiClient } from './client';
import { createQueryClient, shouldRetry } from './query-client';
import { EndpointNotImplementedError, selectImplementation, unavailableService } from './seam';

/**
 * Transport tests.
 *
 * The one that matters most is `does not refresh on invalid_credentials`.
 * That is the live defect in the web client (audit §5, REPO_AUDIT §4
 * finding 3.2) which turns a mistyped password into a forced logout, and
 * this suite is what stops it being reproduced here.
 */

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(responses: readonly Response[]): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  let index = 0;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return Promise.resolve(response as Response);
  });
  return { calls };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

const BASE = 'http://localhost:3000/api/v1';

describe('the response observer (W-06)', () => {
  it('sees the headers of a successful response', async () => {
    stubFetch([json(200, { data: { ok: true } }, { 'X-Minimum-App-Version': '9.9.9' })]);
    const client = new ApiClient(BASE);
    const seen: (string | null)[] = [];
    client.addResponseObserver((headers) => seen.push(headers.get('X-Minimum-App-Version')));

    await client.get('health');
    expect(seen).toEqual(['9.9.9']);
  });

  it('sees the headers of a FAILED response too', async () => {
    // The operator's floor has to reach a client whose every call is
    // failing — that is one of the states a forced upgrade rescues.
    stubFetch([json(500, { ref: 'X' }, { 'X-Minimum-App-Version': '9.9.9' })]);
    const client = new ApiClient(BASE);
    const seen: (string | null)[] = [];
    client.addResponseObserver((headers) => seen.push(headers.get('X-Minimum-App-Version')));

    await expect(client.get('health')).rejects.toBeDefined();
    expect(seen).toEqual(['9.9.9']);
  });

  it('never lets a throwing observer break the request', async () => {
    stubFetch([json(200, { data: { ok: true } })]);
    const client = new ApiClient(BASE);
    client.addResponseObserver(() => {
      throw new Error('observer blew up');
    });

    await expect(client.get('health')).resolves.toEqual({ data: { ok: true } });
  });

  it('stops calling an observer that has been detached', async () => {
    stubFetch([json(200, { data: { ok: true } })]);
    const client = new ApiClient(BASE);
    const observer = jest.fn();
    const unsubscribe = client.addResponseObserver(observer);
    unsubscribe();

    await client.get('health');
    expect(observer).not.toHaveBeenCalled();
  });
});

describe('ApiClient headers and URLs', () => {
  it('sends X-Client-Type: mobile on every request', async () => {
    const { calls } = stubFetch([json(200, { data: { ok: true } })]);
    await new ApiClient(BASE).get('health');

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['X-Client-Type']).toBe('mobile');
  });

  it('sends a correlation id and an Accept header', async () => {
    const { calls } = stubFetch([json(200, { data: {} })]);
    await new ApiClient(BASE).get('health');

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/json');
    expect(headers['X-Correlation-Id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('attaches the bearer token only once one is set', async () => {
    const { calls } = stubFetch([json(200, { data: {} }), json(200, { data: {} })]);
    const client = new ApiClient(BASE);

    await client.get('health');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBeUndefined();

    client.setAccessToken('token-abc');
    await client.get('health');
    expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-abc',
    );
  });

  it('sends an Idempotency-Key when one is supplied', async () => {
    const { calls } = stubFetch([json(201, { data: {} })]);
    await new ApiClient(BASE).post('me/appointments', { a: 1 }, { idempotencyKey: 'key-1' });

    expect((calls[0]?.init.headers as Record<string, string>)['Idempotency-Key']).toBe('key-1');
  });

  it('builds query strings and drops empty values', async () => {
    const { calls } = stubFetch([json(200, { data: {} })]);
    await new ApiClient(BASE).get('doctors', {
      params: { q: '', specialtyId: 'SP-01', page: 2, ignored: undefined },
    });

    expect(calls[0]?.url).toBe(`${BASE}/doctors?specialtyId=SP-01&page=2`);
  });

  it('returns undefined for a 204', async () => {
    stubFetch([new Response(null, { status: 204 })]);
    await expect(new ApiClient(BASE).delete('thing')).resolves.toBeUndefined();
  });
});

describe('ApiClient error normalisation', () => {
  it.each([
    [400, 'validation'],
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [500, 'server'],
  ])('maps HTTP %i to kind %s', async (status, kind) => {
    stubFetch([json(status, { message: 'nope' })]);
    await expect(new ApiClient(BASE).get('thing')).rejects.toMatchObject({ kind });
  });

  it('preserves the envelope code', async () => {
    stubFetch([json(401, { code: 'invalid_credentials' })]);
    await expect(new ApiClient(BASE).get('thing')).rejects.toMatchObject({
      kind: 'auth',
      code: 'invalid_credentials',
    });
  });

  it('reads Retry-After on a 429', async () => {
    stubFetch([json(429, {}, { 'Retry-After': '90' })]);
    await expect(new ApiClient(BASE).get('thing')).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterSeconds: 90,
    });
  });

  it('fails a non-JSON success body as a contract error, not a raw SyntaxError', async () => {
    // What a captive portal or a misrouted proxy answers with on a phone.
    stubFetch([
      new Response('<!doctype html><title>Sign in to Wi-Fi</title>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ]);

    const failure = await new ApiClient(BASE).get('me/appointments').then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ResponseContractError);
    expect(failure).not.toBeInstanceOf(SyntaxError);
    expect(failure).toMatchObject({ endpoint: 'me/appointments' });
    // Never the body: it is not ours to log, and on another route it is PHI.
    expect(JSON.stringify(failure)).not.toContain('Wi-Fi');
  });

  it('reads an empty success body as undefined, the way it reads a 204', async () => {
    stubFetch([new Response('', { status: 200 })]);
    await expect(new ApiClient(BASE).post('auth/logout')).resolves.toBeUndefined();
  });

  it('still parses an ordinary JSON success body', async () => {
    stubFetch([json(200, { data: { id: 'a1' } })]);
    await expect(new ApiClient(BASE).get('me/appointments/a1')).resolves.toEqual({
      data: { id: 'a1' },
    });
  });

  it('reports a network failure as kind network', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('down')));
    await expect(new ApiClient(BASE).get('thing')).rejects.toMatchObject({ kind: 'network' });
  });

  it('reports a timeout separately from a network failure', async () => {
    global.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    await expect(new ApiClient(BASE).get('slow', { timeoutMs: 5 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('reports a caller cancellation as kind cancelled', async () => {
    const controller = new AbortController();
    global.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;

    const promise = new ApiClient(BASE).get('slow', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: 'cancelled' });
  });
});

describe('401 handling', () => {
  it('does NOT refresh on 401 invalid_credentials', async () => {
    stubFetch([json(401, { code: 'invalid_credentials' })]);
    const client = new ApiClient(BASE);
    const refresh = jest.fn(() => Promise.resolve('new-token'));
    client.setRefreshHandler(refresh);

    await expect(client.post('auth/login', {})).rejects.toMatchObject({
      kind: 'auth',
      code: 'invalid_credentials',
    });
    // The whole point: a wrong password is not an expired session.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once and replays on 401 token_expired', async () => {
    const { calls } = stubFetch([
      json(401, { code: 'token_expired' }),
      json(200, { data: { ok: true } }),
    ]);
    const client = new ApiClient(BASE);
    const refresh = jest.fn(() => Promise.resolve('new-token'));
    client.setRefreshHandler(refresh);

    await expect(client.get('me/appointments')).resolves.toEqual({ data: { ok: true } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('shares one refresh across concurrent 401s', async () => {
    let call = 0;
    global.fetch = jest.fn(() => {
      call += 1;
      // The first two requests 401; everything after the refresh succeeds.
      return Promise.resolve(
        call <= 2 ? json(401, { code: 'token_expired' }) : json(200, { data: { ok: true } }),
      );
    });

    const client = new ApiClient(BASE);
    // A deferred created up front: both requests must be able to arrive
    // at the refresh before it settles, which is the race being tested.
    let resolveRefresh: (token: string | null) => void = () => undefined;
    const gate = new Promise<string | null>((resolve) => {
      resolveRefresh = resolve;
    });
    const refresh = jest.fn(() => gate);
    client.setRefreshHandler(refresh);

    const first = client.get('a');
    const second = client.get('b');
    // Let both requests run through fetch, normalisation and into
    // `refreshOnce` before the refresh resolves.
    await new Promise((resolve) => setTimeout(resolve, 0));
    resolveRefresh('new-token');

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('notifies session loss exactly once when the refresh fails', async () => {
    stubFetch([json(401, { code: 'token_expired' })]);
    const client = new ApiClient(BASE);
    const onLost = jest.fn();
    client.setRefreshHandler(() => Promise.resolve(null));
    client.setSessionLostHandler(onLost);

    await expect(client.get('me/appointments')).rejects.toMatchObject({ kind: 'auth' });
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('refreshes on the 401 the backend really sends for an expired token (code unauthorized)', async () => {
    // `access-token.guard.ts` throws `AppException.unauthorized()`, whose
    // code is `unauthorized` — never `token_expired`.
    const { calls } = stubFetch([
      json(401, { message: 'Session expired', code: 'unauthorized' }),
      json(200, { data: { ok: true } }),
    ]);
    const client = new ApiClient(BASE);
    const refresh = jest.fn(() => Promise.resolve('new-token'));
    client.setRefreshHandler(refresh);

    await expect(client.get('me/profile')).resolves.toEqual({ data: { ok: true } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
  });

  it('ends the session when the backend rejects the token and the refresh fails', async () => {
    stubFetch([json(401, { message: 'Session expired', code: 'unauthorized' })]);
    const client = new ApiClient(BASE);
    const onLost = jest.fn();
    client.setRefreshHandler(() => Promise.resolve(null));
    client.setSessionLostHandler(onLost);

    await expect(client.get('me/profile')).rejects.toMatchObject({ code: 'unauthorized' });
    expect(onLost).toHaveBeenCalledTimes(1);
  });

  it('never refreshes in answer to the refresh call itself (no self-wait)', async () => {
    stubFetch([json(401, { message: 'Session expired', code: 'unauthorized' })]);
    const client = new ApiClient(BASE);
    // The real handler calls `auth/refresh` through this same client.
    const refresh = jest.fn(async () => {
      await client.post('auth/refresh', { refreshToken: 'spent' });
      return 'never';
    });
    client.setRefreshHandler(refresh);

    await expect(client.post('/auth/refresh', { refreshToken: 'spent' })).rejects.toMatchObject({
      kind: 'auth',
      code: 'unauthorized',
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not loop: a replayed request that 401s again is not refreshed twice', async () => {
    stubFetch([json(401, { code: 'token_expired' })]);
    const client = new ApiClient(BASE);
    const refresh = jest.fn(() => Promise.resolve('new-token'));
    client.setRefreshHandler(refresh);

    await expect(client.get('thing')).rejects.toMatchObject({ kind: 'auth' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe('isTokenExpiryError', () => {
  it('treats a bare 401 as a token failure', () => {
    expect(isTokenExpiryError({ kind: 'auth' })).toBe(true);
  });

  it('does not treat a credentials failure as a token failure', () => {
    expect(isTokenExpiryError({ kind: 'auth', code: 'invalid_credentials' })).toBe(false);
  });

  it('does not treat a non-auth error as a token failure', () => {
    expect(isTokenExpiryError({ kind: 'forbidden' })).toBe(false);
  });
});

describe('retry policy', () => {
  it('retries transient failures', () => {
    expect(shouldRetry(0, { kind: 'network' })).toBe(true);
    expect(shouldRetry(0, { kind: 'timeout' })).toBe(true);
    expect(shouldRetry(0, { kind: 'server', ref: 'X' })).toBe(true);
  });

  it('never retries a decision the server already made', () => {
    expect(shouldRetry(0, { kind: 'forbidden' })).toBe(false);
    expect(shouldRetry(0, { kind: 'not_found' })).toBe(false);
    expect(shouldRetry(0, { kind: 'conflict', detail: 'x' })).toBe(false);
    expect(shouldRetry(0, { kind: 'validation', fieldErrors: {} })).toBe(false);
    expect(shouldRetry(0, { kind: 'rate_limited', retryAfterSeconds: 5 })).toBe(false);
    expect(shouldRetry(0, { kind: 'auth' })).toBe(false);
    expect(shouldRetry(0, { kind: 'cancelled' })).toBe(false);
  });

  it('never retries a missing endpoint', () => {
    expect(shouldRetry(0, new EndpointNotImplementedError('BE-05', 'capability.booking'))).toBe(
      false,
    );
  });

  it('gives up after two attempts', () => {
    expect(shouldRetry(2, { kind: 'network' })).toBe(false);
  });

  it('does not retry something that is not an API error at all', () => {
    // A `TypeError` from this client's own code is a bug, not a
    // transient failure, and retrying it twice hides it behind a delay.
    expect(shouldRetry(0, new TypeError('undefined is not a function'))).toBe(false);
    expect(shouldRetry(0, 'not even an error')).toBe(false);
    expect(shouldRetry(0, undefined)).toBe(false);
  });
});

describe('query parameters (D-01)', () => {
  /**
   * A filter that is silently dropped, or silently wrong, is worse than
   * one that fails: the screen renders a list the patient reads as "all
   * of them". These four cases are what `buildUrl` decides, and none of
   * them had a test.
   */
  async function urlFor(params: Record<string, unknown>): Promise<URL> {
    const { calls } = stubFetch([json(200, { data: {} })]);
    await new ApiClient(BASE).get('/doctors', { params });
    return new URL(calls[0]?.url ?? '');
  }

  it('sends a repeated key for an array, not one joined string', async () => {
    const url = await urlFor({ specialtyId: ['SP-1', 'SP-2'] });

    expect(url.searchParams.getAll('specialtyId')).toEqual(['SP-1', 'SP-2']);
  });

  it('sends numbers and booleans as the server spells them', async () => {
    const url = await urlFor({ page: 2, upcoming: true });

    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('upcoming')).toBe('true');
  });

  it('drops a value that would stringify to [object Object]', async () => {
    // The alternative is a filter the server cannot parse and does not
    // reject — a wrong answer rendered as a complete one.
    const url = await urlFor({ q: 'heart', filter: { nested: true } });

    expect(url.searchParams.has('filter')).toBe(false);
    expect(url.searchParams.get('q')).toBe('heart');
  });

  it('drops a non-finite number rather than sending "NaN"', async () => {
    const url = await urlFor({ page: Number.NaN, size: Number.POSITIVE_INFINITY });

    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('size')).toBe(false);
  });

  it('drops an unusable item from inside an array and keeps the rest', async () => {
    const url = await urlFor({ id: ['A', { bad: 1 }, 'B'] });

    expect(url.searchParams.getAll('id')).toEqual(['A', 'B']);
  });
});

describe('the verbs (D-01)', () => {
  it.each([
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
  ] as const)('%s sends %s', async (method, verb) => {
    const { calls } = stubFetch([json(200, { data: {} })]);
    const client = new ApiClient(BASE);

    await (method === 'delete'
      ? client.delete('/me/sessions/S-1')
      : client[method]('/me/profile', { phone: '+962 7' }));

    expect(calls[0]?.init.method).toBe(verb);
  });

  it('carries the body on a PUT and a PATCH, where a GET has none', async () => {
    // Three responses, not one repeated: a `Response` body can only be
    // read once, and the stub hands the last one out for every extra
    // call.
    const { calls } = stubFetch([
      json(200, { data: {} }),
      json(200, { data: {} }),
      json(200, { data: {} }),
    ]);
    const client = new ApiClient(BASE);

    await client.put('/me/notification-preferences', { channels: { push: false } });
    await client.patch('/me/profile', { phone: '+962 7' });
    await client.get('/me/profile');

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ channels: { push: false } });
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({ phone: '+962 7' });
    expect(calls[2]?.init.body).toBeUndefined();
  });
});

describe('a 401 before anything has wired a refresh (D-03)', () => {
  it('surfaces the auth error instead of crashing on a missing handler', async () => {
    // `onRefresh` is set by `SessionProvider`. A request that races the
    // provider's mount — or one made after logout tore it down — must
    // fail as an auth error, not as "handler is not a function".
    stubFetch([json(401, { message: 'Unauthorized', code: 'token_expired' })]);
    const client = new ApiClient(BASE);

    await expect(client.get('/me/profile')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('does not retry the request when there is nothing to refresh with', async () => {
    const { calls } = stubFetch([json(401, { message: 'Unauthorized', code: 'token_expired' })]);
    const client = new ApiClient(BASE);

    await expect(client.get('/me/profile')).rejects.toBeDefined();
    expect(calls).toHaveLength(1);
  });
});

describe("the query client's own defaults (R-04, R-08, audit §12.4)", () => {
  /**
   * These are decisions, argued at length in `query-client.ts`, and every
   * one of them is a single word that a tidy-up could remove without
   * anything failing. That is what this block is for.
   */
  const defaults = createQueryClient().getDefaultOptions();

  it('never pauses a read or a write on connectivity', () => {
    // `'online'` would leave a first read in `isPending` with no data —
    // an endless skeleton where R-04 asks for an offline error state —
    // and would HOLD a mutation and replay it on reconnect, which is the
    // queue audit §12.4 forbids.
    expect(defaults.queries?.networkMode).toBe('always');
    expect(defaults.mutations?.networkMode).toBe('always');
  });

  it('never retries a mutation', () => {
    // A booking replayed against a slot that no longer exists is worse
    // than a clear failure the patient can act on.
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('re-asks when the signal comes back, and not when the app is focused', () => {
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
  });

  it('backs off exponentially and stops at eight seconds', () => {
    const delay = defaults.queries?.retryDelay;
    if (typeof delay !== 'function') throw new Error('retryDelay is not a function');

    expect(delay(0, new Error('x'))).toBe(1000);
    expect(delay(1, new Error('x'))).toBe(2000);
    // The ceiling is the point: without it a third attempt would be
    // four seconds and a tenth would be a quarter of an hour.
    expect(delay(10, new Error('x'))).toBe(8000);
  });

  it('holds a read for thirty seconds, and not for the morning', () => {
    expect(defaults.queries?.staleTime).toBe(30_000);
  });
});

describe('the service seam', () => {
  it('selects the fixture adapter when mocks are on', () => {
    expect(selectImplementation(true, { fixture: 'F', http: 'H' })).toBe('F');
    expect(selectImplementation(false, { fixture: 'F', http: 'H' })).toBe('H');
  });

  it('makes a missing endpoint fail loudly and name its dependency', async () => {
    interface Thing {
      load(): Promise<void>;
    }
    const service = unavailableService<Thing>('BE-05', 'capability.booking', ['load']);

    await expect(service.load()).rejects.toBeInstanceOf(EndpointNotImplementedError);
    await expect(service.load()).rejects.toMatchObject({
      dependency: 'BE-05',
      capability: 'capability.booking',
    });
  });
});

describe('isApiError', () => {
  it('recognises a normalized error and rejects anything else', () => {
    expect(isApiError({ kind: 'network' })).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
