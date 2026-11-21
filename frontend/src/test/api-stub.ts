import { vi } from 'vitest';

/**
 * A routed `fetch` stub for HTTP-adapter tests (FE-10).
 *
 * Adapters are tested against the real `ApiClient`, so the request a test
 * observes is the one the browser would send — path, query, method, body
 * and headers — and the response goes through the real error
 * normalization. Only the network is replaced.
 *
 * Routes are `"METHOD /path"` (path relative to the API base, no query);
 * a handler answers a body (wrapped as 200 JSON) or a full `Response`.
 * A request no route matches rejects (the client reports it as a network
 * failure) and is recorded in `unmatched`, so a test can assert none.
 */

export interface StubbedRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
}

type Handler = (request: StubbedRequest) => unknown;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** `{ data }` around a payload — every 2xx body the API sends (API §0.2). */
export function envelope(data: unknown): { data: unknown } {
  return { data };
}

/** A one-page `Paginated<T>` payload, enveloped. */
export function pageOf(items: readonly unknown[]): { data: unknown } {
  return envelope({
    items,
    page: 1,
    pageSize: 100,
    totalItems: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  });
}

export function stubApi(routes: Record<string, Handler>) {
  const requests: StubbedRequest[] = [];
  const unmatched: string[] = [];
  const fetchMock = vi.fn((input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^.*\/api\/v1/, '');
    const method = (init.method ?? 'GET').toUpperCase();
    const request: StubbedRequest = {
      method,
      path,
      query: url.searchParams,
      // A multipart body is kept as the `FormData` it is, so a test can read its parts.
      body:
        typeof init.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : init.body instanceof FormData
            ? init.body
            : undefined,
      headers: (init.headers ?? {}) as Record<string, string>,
    };
    requests.push(request);
    const handler = routes[`${method} ${path}`];
    if (handler === undefined) {
      unmatched.push(`${method} ${path}`);
      return Promise.reject(new Error(`api-stub: no route for ${method} ${path}`));
    }
    const answer = handler(request);
    return Promise.resolve(answer instanceof Response ? answer : json(answer));
  });
  vi.stubGlobal('fetch', fetchMock);
  return { requests, unmatched, fetchMock };
}
