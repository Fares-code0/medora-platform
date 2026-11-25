import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The M6 exit gate, from the API's side (RM M6).
 *
 * The gate asks that "the frontend with `VITE_ENABLE_MOCKS=false`
 * completes login → silent refresh on boot → logout against this API",
 * and the roadmap itself notes it is *blocked on M39.1–M39.4* — the
 * frontend has no HTTP auth service yet (`AuthProvider` imports
 * `features/auth/mock/mock-auth-service` directly, with no seam that
 * reads `enableMocks`) and its `ErrorBody` has no `code` field.
 *
 * What can be settled now is the half that is this milestone's: that the
 * conversation the frontend's own `ApiClient` will hold works, byte for
 * byte, against this API. So the requests below are built the way
 * `src/api/client.ts` builds them — `Accept: application/json`, a
 * `X-Correlation-Id` per request, `Authorization: Bearer` when a token is
 * held, the cookie sent alongside — and the responses are asserted
 * against what `src/api/errors.ts` reads off them.
 *
 * A failure here is a frontend integration failure discovered at M40,
 * which is exactly the cost this file exists to avoid.
 */
let harness: AuthHarness;
const BASE = '/api/v1';
const PASSWORD = 'Medora123!';

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}
interface AuthPayload {
  user: SessionUser;
  accessToken: string;
  expiresIn: number;
}

/**
 * The `ApiClient` conversation, transcribed.
 *
 * Deliberately not an import: the backend does not depend on the
 * frontend package, and a test that imported the real client would prove
 * the two agree only for as long as the import resolves. Transcribing it
 * means a change on either side shows up as a diff someone reads.
 */
class ClientLike {
  private accessToken: string | null = null;
  private cookie: string | null = null;

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async post<T>(path: string, body?: unknown): Promise<{ status: number; data: T; raw: unknown; headers: Record<string, unknown> }> {
    let call = request(harness.server)
      .post(`${BASE}${path}`)
      .set('Accept', 'application/json')
      .set('X-Correlation-Id', crypto.randomUUID());

    if (this.accessToken !== null) call = call.set('Authorization', `Bearer ${this.accessToken}`);
    // `credentials: 'include'` — the browser attaches the cookie; here it
    // is attached explicitly, because supertest's jar will not send a
    // `Secure` cookie over plain HTTP.
    if (this.cookie !== null) call = call.set('Cookie', this.cookie);

    const response = body === undefined ? await call : await call.send(body as object);
    this.captureCookie(response.headers['set-cookie']);

    const envelope = response.body as { data?: T };
    return {
      status: response.status,
      data: envelope.data as T,
      raw: response.body,
      headers: response.headers as unknown as Record<string, unknown>,
    };
  }

  get hasCookie(): boolean {
    return this.cookie !== null && this.cookie.length > 'medora_rt='.length;
  }

  /** The `medora_rt=…` pair, for asserting rotation. */
  get cookieValue(): string | null {
    return this.cookie;
  }

  adoptCookieFrom(other: ClientLike): void {
    this.cookie = other.cookieValue;
  }

  private captureCookie(header: unknown): void {
    const cookies = Array.isArray(header) ? header : [header];
    const set = cookies.find(
      (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
    );
    if (set !== undefined) this.cookie = set.split(';')[0] ?? null;
  }
}

/** `normalizeHttpError` (`src/api/errors.ts`), transcribed. */
type ApiErrorKind =
  | 'validation'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server';

function normalizeKind(status: number): ApiErrorKind {
  switch (status) {
    case 400:
    case 422:
      return 'validation';
    case 401:
      return 'auth';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'server';
  }
}

beforeAll(async () => {
  harness = await createAuthHarness('contract');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('the frontend conversation', () => {
  async function account(local: string): Promise<string> {
    const email = testEmail(local);
    await request(harness.server).post(`${BASE}/auth/register`).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);
    // Clinical standing (§2.6): without it a registered doctor holds no permission.
    await makeClinicalDoctor(harness.prisma, email);
    return email;
  }

  it('completes login → silent refresh on boot → logout', async () => {
    const email = await account('amelia');
    const client = new ClientLike();

    // 1. Sign in. The client stores the access token in memory and the
    //    browser keeps the refresh cookie.
    const login = await client.post<AuthPayload>('/auth/login', {
      email,
      password: PASSWORD,
      rememberMe: true,
    });
    expect(login.status).toBe(200);
    expect(login.data.user.email).toBe(email);
    expect(login.data.expiresIn).toBe(900);
    expect(client.hasCookie).toBe(true);
    client.setAccessToken(login.data.accessToken);

    // 2. Boot. A reload loses the in-memory token, so the shell refreshes
    //    with the cookie alone — the response carries the user, which is
    //    how the shell knows who it is rendering for.
    const reloaded = new ClientLike();
    reloaded.adoptCookieFrom(client);
    const beforeRefresh = reloaded.cookieValue;

    const refresh = await reloaded.post<AuthPayload>('/auth/refresh');
    expect(refresh.status).toBe(200);
    expect(refresh.data.user.email).toBe(email);
    expect(refresh.data.user.permissions).toContain('patients.view');
    // The **cookie** is what must change: it is the credential with a
    // thirty-day life. The access token may come back byte-identical
    // when a refresh lands in the same second as the sign-in — its
    // claims are the same and JWT timestamps have one-second resolution
    // — which is harmless, and asserting otherwise would be a flaky test
    // of the clock rather than of rotation.
    expect(reloaded.cookieValue).not.toBe(beforeRefresh);
    reloaded.setAccessToken(refresh.data.accessToken);

    // 3. Sign out. 204 with no body, which the client returns as
    //    `undefined` without parsing.
    const logout = await reloaded.post<undefined>('/auth/logout');
    expect(logout.status).toBe(204);
    expect(logout.raw).toEqual({});

    // 4. The session is over: the next boot refresh is a 401, which the
    //    client maps to `kind: 'auth'` and turns into a hard log-out.
    const afterLogout = await reloaded.post('/auth/refresh');
    expect(afterLogout.status).toBe(401);
    expect(normalizeKind(afterLogout.status)).toBe('auth');
  });

  it('wraps every success in the { data } envelope the client unwraps', async () => {
    const email = await account('amelia');
    const client = new ClientLike();

    const login = await client.post<AuthPayload>('/auth/login', {
      email,
      password: PASSWORD,
      rememberMe: false,
    });

    expect(Object.keys(login.raw as object)).toEqual(['data']);
  });

  it('returns exactly the SessionUser fields, and nothing more', async () => {
    const email = await account('amelia');
    const client = new ClientLike();

    const login = await client.post<AuthPayload>('/auth/login', {
      email,
      password: PASSWORD,
      rememberMe: false,
    });

    // `frontend/src/types/auth/index.ts` — "the authenticated user as
    // exposed by the AuthProvider — nothing more". An extra field here is
    // a PHI-adjacent leak waiting to be rendered.
    expect(Object.keys(login.data.user).sort()).toEqual([
      'email',
      'id',
      'name',
      'permissions',
      'role',
    ]);
  });

  it('echoes the correlation id as the error ref (API §0.1)', async () => {
    const correlationId = crypto.randomUUID();

    const response = await request(harness.server)
      .post(`${BASE}/auth/login`)
      .set('X-Correlation-Id', correlationId)
      .send({ email: 'not-an-email', password: 'x', rememberMe: false });

    expect(response.headers['x-correlation-id']).toBe(correlationId);
  });

  describe('the error contract (API §0.3)', () => {
    it('maps a wrong password to kind auth', async () => {
      const email = await account('amelia');
      const response = await new ClientLike().post(`/auth/login`, {
        email,
        password: 'Wrong123!',
        rememberMe: false,
      });

      expect(normalizeKind(response.status)).toBe('auth');
      // ADR-012: the backend always sends `code`; the frontend's
      // `ErrorBody` gains the optional field at M39.1.
      expect((response.raw as { code: string }).code).toBe('invalid_credentials');
    });

    it('maps an unverified account to kind forbidden', async () => {
      const email = testEmail('priya');
      await request(harness.server).post(`${BASE}/auth/register`).send(registrationBody({ email }));

      const response = await new ClientLike().post('/auth/login', {
        email,
        password: PASSWORD,
        rememberMe: false,
      });

      expect(normalizeKind(response.status)).toBe('forbidden');
      expect((response.raw as { code: string }).code).toBe('email_unverified');
    });

    it('sends fieldErrors on a validation failure', async () => {
      const response = await new ClientLike().post('/auth/register', registrationBody({ password: 'weak' }));

      expect(normalizeKind(response.status)).toBe('validation');
      // The client hands this straight to React Hook Form's `setError`.
      expect((response.raw as { fieldErrors: Record<string, string[]> }).fieldErrors).toHaveProperty(
        'password',
      );
    });

    it('sends detail on a conflict', async () => {
      const email = await account('amelia');
      const response = await new ClientLike().post('/auth/register', registrationBody({ email }));

      expect(normalizeKind(response.status)).toBe('conflict');
      expect((response.raw as { detail: string }).detail).toBeTruthy();
    });

    it('sends Retry-After on a rate limit', async () => {
      const email = await account('amelia');
      const client = new ClientLike();
      let response = await client.post('/auth/login', { email, password: 'Wrong123!', rememberMe: false });
      for (let attempt = 0; attempt < 4; attempt += 1) {
        response = await client.post('/auth/login', { email, password: 'Wrong123!', rememberMe: false });
      }

      expect(normalizeKind(response.status)).toBe('rate_limited');
      // `errors.ts` reads the header and falls back to 30 if it is absent
      // — a fallback that would quietly hide a missing header.
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('the 401 → refresh → replay interceptor', () => {
    it('lets a stale access token be replaced without a re-login', async () => {
      // `client.ts` retries once after a 401 when a refresh handler is
      // registered. The property that makes it work is that a refresh
      // succeeds while an access token is already expired — the two
      // credentials are independent.
      const email = await account('amelia');
      const client = new ClientLike();
      await client.post<AuthPayload>('/auth/login', {
        email,
        password: PASSWORD,
        rememberMe: false,
      });

      client.setAccessToken('an.expired.token');
      const rejected = await client.post('/auth/logout');
      expect(rejected.status).toBe(401);

      const refreshed = await client.post<AuthPayload>('/auth/refresh');
      expect(refreshed.status).toBe(200);
      client.setAccessToken(refreshed.data.accessToken);

      const replayed = await client.post('/auth/logout');
      expect(replayed.status).toBe(204);
    });
  });
});
