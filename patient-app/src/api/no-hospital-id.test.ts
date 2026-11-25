import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ApiClient, apiClient } from './client';
import { appointmentEndpoints } from './endpoints/appointments';
import { authEndpoints } from './endpoints/auth';
import { doctorEndpoints } from './endpoints/doctors';
import { notificationEndpoints } from './endpoints/notifications';
import { profileEndpoints } from './endpoints/profile';

/**
 * The app never tells the server which hospital it is talking to.
 *
 * Why this is a guard and not a feature: the server binds the hospital
 * from the authenticated account (ADR-042 — the hospital is the isolation
 * boundary; CLIENTS_CHECKLIST and SECURITY_AND_DATA_ISOLATION under
 * `docs/multi-hospital/`). A client that asserted one — in a header, a
 * query string or a body — would be asking the server to trust a value an
 * attacker, or a modified app, can set to anything. The only safe client
 * contribution is none, so this suite fails the day a hospital, tenant,
 * facility or clinic selector appears on the request side.
 *
 * Response fields such as `clinicTimezone` are data the server sends and
 * are not what is scanned for; only names a client could SEND are.
 */

/** Header names and parameter keys that would select a hospital. */
const SELECTOR =
  /(hospital|tenant|facility|clinic|org(anisation|anization)?)[-_ ]?(id|uuid|key|code)?$/i;
const SELECTOR_HEADER = /^x-(hospital|tenant|facility|clinic|org)/i;

function isSelectorName(name: string): boolean {
  return SELECTOR_HEADER.test(name) || SELECTOR.test(name);
}

interface Sent {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function stubFetch(): Sent[] {
  const sent: Sent[] = [];
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: new URL(String(input)),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    });
    return Promise.resolve(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
  });
  return sent;
}

function keysDeep(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, into));
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.push(key);
      keysDeep(inner, into);
    }
  }
  return into;
}

function expectNoHospitalSelector(sent: readonly Sent[]) {
  expect(sent.length).toBeGreaterThan(0);
  for (const request of sent) {
    for (const header of Object.keys(request.headers)) {
      expect({ header, selector: isSelectorName(header) }).toEqual({ header, selector: false });
    }
    for (const key of request.url.searchParams.keys()) {
      expect({ query: key, selector: isSelectorName(key) }).toEqual({
        query: key,
        selector: false,
      });
    }
    for (const key of keysDeep(request.body)) {
      expect({ body: key, selector: isSelectorName(key) }).toEqual({ body: key, selector: false });
    }
  }
}

describe('the selector matcher itself', () => {
  it.each([
    'X-Hospital-Id',
    'x-tenant',
    'hospitalId',
    'hospital_id',
    'tenantId',
    'facilityId',
    'clinicId',
  ])('flags %s', (name) => expect(isSelectorName(name)).toBe(true));

  it.each([
    'Authorization',
    'X-Client-Type',
    'X-Correlation-Id',
    'Idempotency-Key',
    'specialtyId',
    'page',
  ])('does not flag %s', (name) => expect(isSelectorName(name)).toBe(false));
});

describe('the real ApiClient', () => {
  it('adds no hospital selector of its own, signed in, with a body and an idempotency key', async () => {
    const sent = stubFetch();
    const client = new ApiClient('http://localhost:3000/api/v1');
    client.setAccessToken('access-1');

    await client.get('me/profile', { params: { page: 2, q: 'x' } });
    await client.post('me/appointments', { note: 'hello' }, { idempotencyKey: 'k-1' });
    await client.patch('me/profile', { phone: '+100' });
    await client.delete('me/sessions/s-1');

    expect(sent).toHaveLength(4);
    // The header set is exactly the transport's own — a new header is a
    // decision someone must make here, not a side effect.
    const allowed = new Set([
      'accept',
      'x-client-type',
      'x-correlation-id',
      'content-type',
      'idempotency-key',
      'authorization',
    ]);
    for (const request of sent) {
      for (const header of Object.keys(request.headers)) {
        expect(allowed.has(header.toLowerCase())).toBe(true);
      }
    }
    expectNoHospitalSelector(sent);
  });
});

describe('representative calls through the real endpoints', () => {
  afterEach(() => {
    apiClient.setAccessToken(null);
  });

  it('send no hospital, tenant, facility or clinic selector', async () => {
    const sent = stubFetch();
    apiClient.setAccessToken('access-1');

    // The responses are `{}`, which the endpoint schemas reject; only the
    // outgoing request is under test.
    const calls: Array<() => Promise<unknown>> = [
      () => appointmentEndpoints.list({ upcoming: true, sort: 'startsAt:asc', page: 1 }),
      () => appointmentEndpoints.byId('APT-1'),
      () =>
        doctorEndpoints.search({ q: 'heart', specialtyId: 's-1', departmentId: 'd-1', page: 1 }),
      () => profileEndpoints.get(),
      () => notificationEndpoints.feed({ page: 1 }),
      () => notificationEndpoints.badgeCounts(),
      () => authEndpoints.login({ email: 'a@b.test', password: 'pw', rememberMe: false }),
    ];
    for (const call of calls) await call().catch(() => undefined);

    expect(sent).toHaveLength(calls.length);
    expectNoHospitalSelector(sent);
  });
});

describe('the endpoint sources', () => {
  const dir = join(__dirname, 'endpoints');
  const files = readdirSync(dir).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );

  it('scans every endpoint module', () => {
    expect(files).toEqual(expect.arrayContaining(['appointments.ts', 'auth.ts', 'doctors.ts']));
  });

  it.each(files)('%s names no hospital selector as a header, param or body field', (file) => {
    // Comments are stripped: prose may explain why there is no selector.
    const code = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const offenders = code.match(
      /\b(hospital|tenant|facility)[A-Za-z_]*\b|['"`]x-(hospital|tenant|facility|clinic)[^'"`]*['"`]|\bclinic(Id|_id)\b/gi,
    );
    expect(offenders).toBeNull();
  });
});
