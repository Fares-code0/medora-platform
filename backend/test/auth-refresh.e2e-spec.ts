import { CookieAccessInfo, CookieJar } from 'cookiejar';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionService } from '../src/modules/auth/services/session.service';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * `POST /auth/refresh` and `POST /auth/logout` (RM M6.3, API §1.5–1.6).
 *
 * The roadmap's verification: "reuse of a rotated token → 401 and the
 * whole family revoked", and "cookie `Path` matches the M0.6-1 ADR and is
 * actually sent by the browser". The second one cannot be checked by
 * asserting the `Set-Cookie` header alone — that only proves what was
 * *offered*. Supertest's agent applies the browser's own matching rules,
 * so a cookie it re-sends to `/api/v1/auth/refresh` is a cookie a browser
 * would re-send.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

function refreshTokenOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

/** Signs in and returns the raw refresh token plus the access token. */
async function signIn(email: string): Promise<{ refreshToken: string; accessToken: string }> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return {
    refreshToken: refreshTokenOf(response),
    accessToken: dataOf<SessionPayload>(response).accessToken,
  };
}

function withCookie(token: string): string {
  return `medora_rt=${token}`;
}

/**
 * Ages a session out.
 *
 * `started_at` moves too, because DB §9's `sessions_expires_after_start`
 * CHECK refuses a row that expires before it began — a constraint worth
 * respecting rather than working around, since it is what stops a bug
 * from writing an already-dead session.
 */
async function expireSession(email: string): Promise<void> {
  const past = Date.now() - 60_000;
  await harness.prisma.session.updateMany({
    where: { user: { email } },
    data: { startedAt: new Date(past), expiresAt: new Date(past + 1_000) },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('refresh');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('refresh', () => {
  it('returns a new access token and the session user', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));

    expect(response.status).toBe(200);
    const payload = dataOf<SessionPayload>(response);
    // The frontend refreshes before it has a session, so this response is
    // where the shell learns who it is rendering for.
    expect(payload.user.email).toBe(email);
    expect(payload.user.role).toBe('doctor');
    expect(payload.user.permissions).toContain('patients.view');
    expect(payload.expiresIn).toBe(900);
  });

  it('rotates the cookie — the old token stops working', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken: first } = await signIn(email);

    const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
    const second = refreshTokenOf(rotated);

    expect(second).not.toBe(first);
    expect(second.length).toBeGreaterThan(20);

    const replay = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
    expect(replay.status).toBe(401);
  });

  it('keeps one session row across rotations rather than growing one per refresh', async () => {
    const email = await seedAccount('amelia');
    let token = (await signIn(email)).refreshToken;

    for (let round = 0; round < 3; round += 1) {
      const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(token));
      expect(response.status).toBe(200);
      token = refreshTokenOf(response);
    }

    // The row is the family. A row per rotation would be ~2,880 rows per
    // remembered user per month, for a table nothing prunes yet (ADR-007).
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it('slides the expiry forward', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);
    const before = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });

    await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    const after = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });

    // API §1.5 — an active user is not signed out mid-shift, while an
    // abandoned session still ages out.
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('is refused for a session that has expired', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    await expireSession(email);

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(response.status).toBe(401);
  });

  it('is refused with no cookie at all', async () => {
    expect((await request(harness.server).post(REFRESH)).status).toBe(401);
  });

  it('is refused for a token that was never issued', async () => {
    const response = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', withCookie('a-token-nobody-ever-issued'));

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('unauthorized');
  });

  it('is refused once the account is deactivated', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    // Soft delete is how M8.2 deactivates an account. A live session must
    // not outlive it.
    await harness.prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(response.status).toBe(401);
  });

  describe('reuse detection', () => {
    it('revokes the session when a rotated token comes back', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken: stolen } = await signIn(email);

      // The attacker refreshes first, taking the new token.
      const attacker = await request(harness.server).post(REFRESH).set('Cookie', withCookie(stolen));
      expect(attacker.status).toBe(200);
      const attackerToken = refreshTokenOf(attacker);

      // The real client then presents the one it still holds.
      const victim = await request(harness.server).post(REFRESH).set('Cookie', withCookie(stolen));
      expect(victim.status).toBe(401);

      // By now two parties hold tokens for one session and there is no way
      // to tell which is the user, so the session ends for both.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.revokedAt).not.toBeNull();

      const afterRevocation = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(attackerToken));
      expect(afterRevocation.status).toBe(401);
    });

    it("leaves the user's other sessions alone", async () => {
      const email = await seedAccount('amelia');
      const compromised = (await signIn(email)).refreshToken;
      const otherDevice = (await signIn(email)).refreshToken;

      await request(harness.server).post(REFRESH).set('Cookie', withCookie(compromised));
      await request(harness.server).post(REFRESH).set('Cookie', withCookie(compromised));

      // The row is the family: a replay on the phone does not sign the
      // user out of the workstation.
      const stillWorks = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(otherDevice));
      expect(stillWorks.status).toBe(200);
    });

    it('does not fire for a token that merely expired', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);
      await expireSession(email);

      await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));

      // An expired session is not a compromised one; revoking on expiry
      // would make every returning user look like an incident.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.revokedAt).toBeNull();
    });
  });

  describe('two refreshes of one token at once', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /**
     * Both requests read the session as live, then both try to rotate it.
     * `rotate` is conditional on the presented hash, so exactly one wins
     * and the other gets `null` (`RefreshService`: "Lost a race with a
     * concurrent refresh. Not a replay"). The race is staged rather than
     * hoped for: the spy lets the HTTP request read the live row, then
     * rotates it on the other request's behalf before the HTTP request's
     * own rotation runs.
     */
    async function refreshThatLosesTheRace(
      refreshToken: string,
    ): Promise<{ status: number; code: string; cookie: string; winner: string }> {
      const sessions = harness.app.get(SessionService);
      const findLive = sessions.findLive.bind(sessions);
      let winner = '';

      vi.spyOn(sessions, 'findLive').mockImplementationOnce(async (token) => {
        const live = await findLive(token);
        if (live === null) throw new Error('fixture: the session should be live');
        const rotated = await sessions.rotate(live, token);
        if (rotated === null) throw new Error('fixture: the concurrent rotation should win');
        winner = rotated.refreshToken;
        return live;
      });

      const response = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(refreshToken));
      return {
        status: response.status,
        code: errorBody(response).code,
        cookie: refreshTokenOf(response),
        winner,
      };
    }

    it('refuses the loser with 401 and issues it no cookie', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      const loser = await refreshThatLosesTheRace(refreshToken);

      expect(loser.status).toBe(401);
      expect(loser.code).toBe('unauthorized');
      expect(loser.cookie).toBe('');
    });

    it('is not treated as a replay: the session stands and the winning token still refreshes', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      const { winner } = await refreshThatLosesTheRace(refreshToken);

      // Revoking here would sign out a user who did nothing wrong, which
      // is what the conditional update exists to prevent.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.revokedAt).toBeNull();

      const next = await request(harness.server).post(REFRESH).set('Cookie', withCookie(winner));
      expect(next.status).toBe(200);
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
    });
  });

  describe('a session started without a request context', () => {
    it('stores no device and no address, and is live', async () => {
      const email = await seedAccount('amelia');
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
      const sessions = harness.app.get(SessionService);

      // `req.ip` is `undefined` once the client's socket has gone, so the
      // controller can hand `start` an empty address. Nothing is invented.
      const issued = await sessions.start(user.id, false);

      expect(issued.session.device).toBeNull();
      expect(issued.session.ipAddress).toBeNull();
      expect((await sessions.findLive(issued.refreshToken))?.id).toBe(issued.session.id);
    });
  });

  describe('the mobile variant (API §1.5)', () => {
    it('accepts the token in the body when X-Client-Type is mobile', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      const response = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(dataOf<SessionPayload>(response).user.email).toBe(email);
    });

    it('ignores a body token when a cookie is present', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      // The header is a fallback selector, not an override: a browser must
      // not be talked into using a body token by a header an attacker set.
      const response = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .set('Cookie', withCookie(refreshToken))
        .send({ refreshToken: 'a-token-nobody-ever-issued' });

      expect(response.status).toBe(200);
    });

    it('ignores a body token without the header', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      expect((await request(harness.server).post(REFRESH).send({ refreshToken })).status).toBe(401);
    });
  });

  /**
   * ADR-011's real risk is not what the server *offers* — the login spec
   * already asserts the attributes — but what a client **returns**. A
   * cookie scoped to the wrong path is set successfully and then never
   * sent again, and silent refresh stops working with no error anywhere.
   *
   * So the header the server actually produced is fed to a real cookie
   * implementation (`cookiejar`, the one superagent itself uses) and
   * asked what it would send where. Supertest's own agent cannot answer
   * this over plain HTTP: the cookie is `Secure`, and the library models
   * neither a browser's localhost exemption nor TLS.
   */
  describe('the cookie a client would actually send back', () => {
    async function jarFrom(email: string): Promise<CookieJar> {
      const login = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      const raw: unknown = login.headers['set-cookie'];
      const headers = (Array.isArray(raw) ? raw : [raw]).filter(
        (value): value is string => typeof value === 'string',
      );

      const jar = new CookieJar();
      jar.setCookies(headers);
      return jar;
    }

    const sentTo = (jar: CookieJar, path: string): string[] =>
      jar.getCookies(new CookieAccessInfo('localhost', path, true, false)).map((c) => c.name);

    it('is returned to the auth routes', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      expect(sentTo(jar, '/api/v1/auth/refresh')).toContain('medora_rt');
      expect(sentTo(jar, '/api/v1/auth/logout')).toContain('medora_rt');
    });

    it('is not attached to any other request', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      // The scoping is what keeps a 30-day credential off every clinical
      // request, where a logging middleware or a proxy could capture it.
      expect(sentTo(jar, '/api/v1/patients')).toEqual([]);
      expect(sentTo(jar, '/api/v1/health')).toEqual([]);
      expect(sentTo(jar, '/')).toEqual([]);
    });

    it('is withheld from an insecure connection', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      expect(sentTo(jar, '/api/v1/auth/refresh')).toContain('medora_rt');
      // Same jar, same path, `secure: false` — the Secure attribute is
      // the only thing that changed the answer.
      const overPlainHttp = jar
        .getCookies(new CookieAccessInfo('localhost', '/api/v1/auth/refresh', false, false))
        .map((cookie) => cookie.name);
      expect(overPlainHttp).toEqual([]);
    });
  });
});

describe('logout', () => {
  it('answers 204, revokes the session and clears the cookie', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken, accessToken } = await signIn(email);

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(204);
    expect(refreshTokenOf(response)).toBe('');

    const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(session.revokedAt).not.toBeNull();

    const afterLogout = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(afterLogout.status).toBe(401);
  });

  it('clears the cookie with the attributes it was set with', async () => {
    const email = await seedAccount('amelia');
    const { accessToken } = await signIn(email);

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${accessToken}`);

    const raw: unknown = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const cleared = cookies.find(
      (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
    );

    // A browser matches a deletion by name, domain and path — omit the
    // path and the cookie survives the logout.
    expect(cleared).toContain('Path=/api/v1/auth');
    expect(cleared).toContain('HttpOnly');
  });

  it('requires an access token', async () => {
    expect((await request(harness.server).post(LOGOUT)).status).toBe(401);
  });

  it('refuses a forged token', async () => {
    const email = await seedAccount('amelia');
    const { accessToken } = await signIn(email);
    const tampered = `${accessToken.slice(0, -4)}AAAA`;

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${tampered}`);

    expect(response.status).toBe(401);
  });

  it('ends only the session the token names', async () => {
    const email = await seedAccount('amelia');
    const first = await signIn(email);
    await signIn(email);

    await request(harness.server).post(LOGOUT).set('Authorization', `Bearer ${first.accessToken}`);

    const live = await harness.prisma.session.count({
      where: { user: { email }, revokedAt: null },
    });
    expect(live).toBe(1);
  });
});
