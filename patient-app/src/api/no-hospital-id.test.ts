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
      () => appointmentEndpoints.book({ slotId: 's-1', reason: 'Checkup' }, 'key-1'),
      () => appointmentEndpoints.cancel('APT-1', { reasonCode: 'other' }),
      () => appointmentEndpoints.requestReschedule('APT-1', { slotId: 's-2' }, 'key-2'),
      () => appointmentEndpoints.slots('doc-1', 'a', 'b'),
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
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      // A RESPONSE field the server returns (`hospital: { id, name }` on a
      // lab order) is read, never sent: only its schema declaration is
      // exempt, and only in the shape `hospital: <name>Schema`.
      .replace(/^\s*hospital: \w+Schema(\.nullable\(\))?,$/gm, '');
    const offenders = code.match(
      /\b(hospital|tenant|facility)[A-Za-z_]*\b|['"`]x-(hospital|tenant|facility|clinic)[^'"`]*['"`]|\bclinic(Id|_id)\b/gi,
    );
    // Each name below is a RESPONSE field or a discovery resource, never a
    // selector sent to scope a request. Scope is the session's alone; a
    // name is added here only with that justification, per file.
    const allowed = ALLOWED_HOSPITAL_NAMES[file] ?? new Set<string>();
    const unexplained = (offenders ?? []).filter((name) => !allowed.has(name.toLowerCase()));
    expect(unexplained).toEqual([]);
  });
});

/**
 * Where the word legitimately appears in an endpoint module.
 *
 * - `appointments.ts`, `doctors.ts`: the `hospital` field of a RESPONSE
 *   projection (`{ id, name }`), and its schema.
 * - `doctors.ts`: `hospitalId` — contract §2's optional discovery FILTER
 *   (which hospital's doctors to list). A patient choosing what to browse
 *   is not a tenant selector: the caller's scope still comes from the
 *   session, and the filter only narrows a list the server already scoped.
 * - `hospitals.ts`: the hospital-discovery resource itself
 *   (`GET /patient/hospitals/{id}`) — the hospital is the thing asked
 *   for, not a header or body field scoping some other request. The
 *   plain word `hospitals` is the URL path segment.
 */
const ALLOWED_HOSPITAL_NAMES: Readonly<Record<string, ReadonlySet<string>>> = {
  'appointments.ts': new Set(['hospital', 'hospitalrefschema']),
  'doctors.ts': new Set(['hospital', 'hospitalrefschema', 'hospitalid']),
  'hospitals.ts': new Set([
    'hospitals',
    'hospitalendpoints',
    'hospitallistquery',
    'hospitalid',
    'wirehospitalsummary',
    'wirehospitaldetail',
  ]),
};
