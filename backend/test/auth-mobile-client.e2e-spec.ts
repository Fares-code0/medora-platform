import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  endGraceWindow,
  errorBody,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { body as mailBody } from './support/smtp-sink';

/**
 * The token-in-body auth variant (MG §15.2, ADR-014, API §1.5).
 *
 * ## What this closes
 *
 * `X-Client-Type: mobile` was honoured on the **request** side of
 * `/auth/refresh` only. Every route that *mints* a refresh token — login,
 * OTP verify, refresh — delivered it exclusively as `Set-Cookie`, so a
 * native client with no cookie jar could not obtain its first token at
 * all, and could not read a rotated one.
 *
 * MG §15.2 already required otherwise — *"return the refresh token in the
 * response body instead of a cookie"* — and RM M41.1's verification is a
 * script that "completes login→refresh→logout **without cookies**", which
 * was impossible. This suite is that script, as tests.
 *
 * ## The property that matters most
 *
 * **Exactly one copy of the credential is issued.** Web gets the
 * `httpOnly` cookie and no body token; mobile gets the body token and no
 * cookie. Issuing both to a mobile client would leave a 30-day credential
 * in a cookie jar the client never reads and cannot clear on logout.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const VERIFY = '/api/v1/auth/verify-email';
const PASSWORD = 'Medora123!';

beforeAll(async () => {
  harness = await createAuthHarness('auth-mobile');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

interface MobilePayload {
  readonly user: { readonly email: string; readonly role: string };
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken?: string;
}

/** Every `Set-Cookie` value on a response. */
function cookiesOf(response: { headers: Record<string, unknown> }): string[] {
  const raw: unknown = response.headers['set-cookie'];
  if (raw === undefined) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter((v): v is string => typeof v === 'string');
}

function refreshCookieOf(response: { headers: Record<string, unknown> }): string | undefined {
  return cookiesOf(response).find((value) => value.startsWith('medora_rt='));
}

/** Registers and verifies an account, returning its email. */
async function seedAccount(local: string, role = 'patient'): Promise<string> {
  const email = testEmail(local);

  await request(harness.server).post(REGISTER).send(registrationBody({ email, role })).expect(201);

  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);

  return email;
}

describe('a native client completes login → refresh → logout without cookies (RM M41.1)', () => {
  it('returns the refresh token in the login body and sets no cookie', async () => {
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    const payload = dataOf<MobilePayload>(login);

    expect(payload.refreshToken).toBeTruthy();
    expect(payload.accessToken).toBeTruthy();
    // "instead of a cookie" — exactly one copy of the credential.
    expect(refreshCookieOf(login)).toBeUndefined();
  });

  it('rotates through the body, and the rotated token is the one that works', async () => {
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    const first = dataOf<MobilePayload>(login).refreshToken!;

    const refreshed = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: first })
      .expect(200);

    const second = dataOf<MobilePayload>(refreshed).refreshToken!;

    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(refreshCookieOf(refreshed)).toBeUndefined();

    // The rotated token is accepted, which is what makes a cold start
    // work on the second day as well as the first.
    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: second })
      .expect(200);
  });

  it('keeps reuse detection intact — replaying a rotated token kills the family', async () => {
    // The security property the whole rotation scheme exists for
    // (ADR-026). It must not weaken because the token now travels in a
    // body: a stolen-and-replayed token has to revoke the session.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    const first = dataOf<MobilePayload>(login).refreshToken!;

    const refreshed = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: first })
      .expect(200);

    const second = dataOf<MobilePayload>(refreshed).refreshToken!;

    // Past ADR-045's 30-second grace window, a retired token is a replay
    // again; inside it, the retry would be answered with `second`.
    await endGraceWindow(harness.prisma, email);

    // Replay the token that was already rotated away.
    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: first })
      .expect(401);

    // The family is revoked, so the *current* token is dead too.
    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: second })
      .expect(401);
  });

  it('answers a retry inside the grace window with the same token, in the body (ADR-045)', async () => {
    // A phone on a flaky network: the rotation succeeded, the response
    // never arrived, and the app re-sends the token it still has. The
    // body variant must re-deliver exactly what the rotation issued, so
    // the app's secure store converges on one token.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);
    const first = dataOf<MobilePayload>(login).refreshToken!;

    const lost = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: first })
      .expect(200);
    const issued = dataOf<MobilePayload>(lost).refreshToken!;

    const retry = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: first })
      .expect(200);

    expect(dataOf<MobilePayload>(retry).refreshToken).toBe(issued);
    expect(retry.headers['set-cookie']).toBeUndefined();
    const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(session.revokedAt).toBeNull();

    // And the re-delivered token is live.
    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: issued })
      .expect(200);
  });

  it('logs out with the access token, no cookie involved', async () => {
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    const payload = dataOf<MobilePayload>(login);

    await request(harness.server)
      .post(LOGOUT)
      .set('X-Client-Type', 'mobile')
      .set('Authorization', `Bearer ${payload.accessToken}`)
      .expect(204);

    // The session is gone, so the refresh token it minted is dead.
    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .send({ refreshToken: payload.refreshToken! })
      .expect(401);
  });

  it('works the same for a doctor account', async () => {
    // The variant is about the *client*, not the role. A doctor using a
    // future mobile app must get the same treatment.
    const email = await seedAccount('amelia', 'doctor');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    expect(dataOf<MobilePayload>(login).refreshToken).toBeTruthy();
    expect(refreshCookieOf(login)).toBeUndefined();
  });
});

describe('the web path is untouched', () => {
  it('sets the cookie and puts no refresh token in the body', async () => {
    // The regression that would matter most: a refresh token appearing in
    // a browser-readable body defeats the entire point of `httpOnly`.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD })
      .expect(200);

    const payload = dataOf<MobilePayload>(login);

    expect(payload.refreshToken).toBeUndefined();

    const cookie = refreshCookieOf(login);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
  });

  it('does not leak a body token on a cookie-based refresh', async () => {
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD })
      .expect(200);

    const cookie = refreshCookieOf(login)!;

    const refreshed = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', cookie.split(';')[0]!)
      .expect(200);

    expect(dataOf<MobilePayload>(refreshed).refreshToken).toBeUndefined();
    expect(refreshCookieOf(refreshed)).toBeDefined();
  });

  it('ignores an unrecognised X-Client-Type value', async () => {
    // Only the exact value `mobile` switches modes. Anything else is a
    // web client, so a typo fails closed rather than into the variant.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'Mobile')
      .send({ email, password: PASSWORD })
      .expect(200);

    expect(dataOf<MobilePayload>(login).refreshToken).toBeUndefined();
    expect(refreshCookieOf(login)).toBeDefined();
  });

  it('still lets a cookie win over a body token on refresh', async () => {
    // Unchanged from before: on the REQUEST side the header is a
    // fallback selector, not an override, so a browser cannot be talked
    // into using an attacker's body token by a header.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD })
      .expect(200);

    const cookie = refreshCookieOf(login)!;

    await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .set('Cookie', cookie.split(';')[0]!)
      .send({ refreshToken: 'a-token-nobody-ever-issued' })
      .expect(200);
  });

  it('answers 401, not 500, for a refresh cookie that does not percent-decode', async () => {
    // The cookie header is the caller's to write, and `decodeURIComponent`
    // throws on a malformed escape: `medora_rt=%` used to answer 500 and
    // log an unhandled exception, for anyone, without signing in.
    for (const value of ['%', '%zz', '%E0%A4%A']) {
      const response = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', `other=1; medora_rt=${value}`)
        .send({});

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('unauthorized');
    }
  });

  it('still lets a malformed cookie win over a valid body token', async () => {
    // A cookie that is present is the credential, decodable or not.
    // Treating a malformed one as absent would let a request fall through
    // to the mobile body path with a cookie it chose to break.
    const email = await seedAccount('sara');

    const login = await request(harness.server)
      .post(LOGIN)
      .set('X-Client-Type', 'mobile')
      .send({ email, password: PASSWORD })
      .expect(200);
    const bodyToken = dataOf<MobilePayload>(login).refreshToken!;

    const response = await request(harness.server)
      .post(REFRESH)
      .set('X-Client-Type', 'mobile')
      .set('Cookie', 'medora_rt=%zz')
      .send({ refreshToken: bodyToken });

    expect(response.status).toBe(401);
  });
});
