import { createHmac } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
 * A forged or malformed access token is a 401 (RM M37.2 "token reuse /
 * fixation", M34.1 auth coverage).
 *
 * The access token is the whole of authentication: the guard checks its
 * signature and reads no database row (`access-token.guard.ts`). So what
 * `AccessTokenService.verify` accepts *is* who can call the API, and two
 * things it relies on had no test:
 *
 * 1. **The algorithm is pinned.** `auth.module.ts` sets
 *    `verifyOptions: { algorithms: ['HS256'] }` because `jsonwebtoken`
 *    otherwise verifies with whatever algorithm the token's own header
 *    names — the `alg: none` family. Deleting that line broke nothing.
 * 2. **A validly signed token with the wrong shape is refused.**
 *    `toPrincipal` rejects rather than coerces, so a token minted before
 *    a claim existed becomes a 401 the client recovers from, not a
 *    principal with `permissions: undefined`. Its refusals were
 *    unreached.
 *
 * Driven over HTTP against the real application, so the module's real
 * configuration is what is under test, not a copy of it. Every forgery
 * starts from a real token's claims, so the only thing wrong with each
 * is the thing the case names.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const PASSWORD = 'Medora123!';
/** Any authenticated route will do; this one reads only the caller. */
const PROTECTED = `${PREFIX}/me/account`;

let realToken: string;
let realClaims: Record<string, unknown>;

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function claimsOf(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

/** Signs with the deployment's own key — a token this API minted. */
function signed(claims: Record<string, unknown>, algorithm: 'HS256' | 'HS512' = 'HS256'): string {
  return new JwtService({ secret: process.env.JWT_SECRET ?? '' }).sign(claims, { algorithm });
}

function call(token: string): request.Test {
  return request(harness.server).get(PROTECTED).set('Authorization', `Bearer ${token}`);
}

async function expectRefused(token: string): Promise<void> {
  const response = await call(token);
  expect(response.status).toBe(401);
  expect(errorBody(response).code).toBeDefined();
}

beforeAll(async () => {
  harness = await createAuthHarness('access-token-forgery');

  const email = testEmail('forgery');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  realToken = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${PREFIX}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  realClaims = claimsOf(realToken);
});

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('the baseline', () => {
  it('accepts the token the API issued, and one re-signed from its claims', async () => {
    // Without this, every refusal below could be a harness that refuses
    // everything.
    expect((await call(realToken)).status).toBe(200);
    expect((await call(signed(realClaims))).status).toBe(200);
  });
});

describe('the algorithm is the server’s choice, not the token’s', () => {
  it('refuses an unsigned token (`alg: none`)', async () => {
    const unsigned = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(realClaims)}.`;
    await expectRefused(unsigned);
  });

  it('refuses HS512 signed with the right key', async () => {
    // The key is right and the signature is valid; only the algorithm is
    // not the one the server pinned.
    await expectRefused(signed(realClaims, 'HS512'));
  });

  it('refuses a token signed with any other key', async () => {
    const foreign = new JwtService({ secret: 'not-this-deployments-key-000000000000' });
    await expectRefused(foreign.sign(realClaims, { algorithm: 'HS256' }));
  });

  it('refuses a real token whose payload was edited', async () => {
    const [header, , signature] = realToken.split('.');
    const promoted = base64url({ ...realClaims, role: 'admin', permissions: ['roles.manage'] });
    await expectRefused(`${header}.${promoted}.${signature}`);
  });

  it('refuses an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectRefused(signed({ ...realClaims, iat: now - 1000, exp: now - 1 }));
  });
});

describe('a validly signed token with the wrong shape is refused, not coerced', () => {
  const malformed: ReadonlyArray<readonly [string, (claims: Record<string, unknown>) => object]> = [
    ['no subject', ({ sub: _sub, ...rest }) => rest],
    ['a numeric subject', (claims) => ({ ...claims, sub: 42 })],
    ['no public id', ({ pid: _pid, ...rest }) => rest],
    ['no role', ({ role: _role, ...rest }) => rest],
    ['no session id', ({ sid: _sid, ...rest }) => rest],
    ['no permissions', ({ permissions: _permissions, ...rest }) => rest],
    // A string is not a list: `'roles.manage'.includes(…)` would answer
    // substring matches if it were ever treated as one.
    ['permissions as a string', (claims) => ({ ...claims, permissions: 'roles.manage' })],
    ['a non-string permission', (claims) => ({ ...claims, permissions: ['patients.view', 7] })],
  ];

  it('refuses a signed payload that is not an object', async () => {
    // `jsonwebtoken` verifies a payload that is valid JSON but not an
    // object — a string or a number — and hands it on; only
    // `toPrincipal` stands between it and a principal.
    const header = base64url({ alg: 'HS256', typ: 'JWT' });
    for (const json of ['"a json string"', '42']) {
      const payload = Buffer.from(json).toString('base64url');
      const signature = createHmac('sha256', process.env.JWT_SECRET ?? '')
        .update(`${header}.${payload}`)
        .digest('base64url');
      await expectRefused(`${header}.${payload}.${signature}`);
    }
  });

  for (const [name, edit] of malformed) {
    it(`refuses ${name}`, async () => {
      const { iat: _iat, exp: _exp, ...claims } = realClaims;
      await expectRefused(signed(edit(claims) as Record<string, unknown>));
    });
  }
});
