import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * API contract audit (2026-11-14) — a user-controlled identifier never
 * becomes a 500.
 *
 * Every path parameter is client input. A route that hands a malformed
 * one to PostgreSQL (`invalid input syntax for type uuid`) answers 500,
 * logs an unhandled exception, and lets anyone with an account fill the
 * error log at will; the contract's answer for "no such thing" is 404
 * (or 422 where the route validates the shape). Individual specs pin this
 * for the routes they own (M8.3's sessions, M13.1's monographs); this one
 * sweeps **every** route Express serves with a parameter, so a route
 * added later is covered without anyone remembering to write the case.
 *
 * Each route is called, for each method it serves, as an administrator, a
 * doctor and a patient, with every parameter set to:
 *
 * - a malformed id (`not-a-uuid`);
 * - a well-formed uuid that names nothing.
 *
 * Bodies are empty, so a write route answers 404 or 422 before it writes;
 * nothing the sweep sends names a real row. The assertion is **no 5xx**
 * other than the deliberate ones: 501 (not built, and saying so) and 503
 * (a dependency the route needs is unconfigured in the test environment,
 * which is what the route is meant to say).
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const PASSWORD = 'Medora123!';
const DELIBERATE = new Set([501, 503]);

const tokens = new Map<string, string>();

interface ExpressLayer {
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean> };
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];

/** `[method, path]` for every route under the prefix that takes a path parameter. */
function parameterisedRoutes(): [Method, string][] {
  const express = harness.app.getHttpAdapter().getInstance() as {
    _router: { stack: ExpressLayer[] };
  };

  return express._router.stack
    .map((layer) => layer.route)
    .filter((route) => route !== undefined)
    .filter((route) => route.path.startsWith(`${PREFIX}/`) && route.path.includes('/:'))
    .flatMap((route) =>
      METHODS.filter((method) => route.methods[method] === true).map((method): [Method, string] => [
        method,
        route.path,
      ]),
    );
}

function fill(path: string, value: string): string {
  return path.replace(/:\w+/g, encodeURIComponent(value));
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function login(email: string): Promise<{ accessToken?: string; otpToken?: string }> {
  return dataOf(
    await request(harness.server)
      .post(`${PREFIX}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  );
}

async function staffToken(local: string, role: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  if (role !== 'doctor') {
    const row = await harness.prisma.role.findUniqueOrThrow({ where: { code: role } });
    await harness.prisma.user.update({ where: { email }, data: { roleId: row.id } });
  }
  return (await login(email)).accessToken ?? '';
}

/** ADR-035: an administrator signs in with a second factor. */
async function adminToken(): Promise<string> {
  const email = testEmail('param-admin');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = (await login(email)).accessToken ?? '';
  const { secret } = dataOf<{ secret: string }>(
    await request(harness.server)
      .post(`${PREFIX}/me/2fa/setup`)
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  );
  await request(harness.server)
    .post(`${PREFIX}/me/2fa/enable`)
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: role.id } });

  const { otpToken } = await login(email);
  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${PREFIX}/auth/otp/verify`)
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

beforeAll(async () => {
  harness = await createAuthHarness('path-params');

  tokens.set('doctor', await staffToken('param-doctor', 'doctor'));
  tokens.set('reception', await staffToken('param-reception', 'reception'));

  const patientEmail = testEmail('param-patient');
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(patientRegistrationBody({ email: patientEmail }));
  await markVerified(harness.prisma, patientEmail);
  tokens.set('patient', (await login(patientEmail)).accessToken ?? '');

  tokens.set('admin', await adminToken());

  for (const [role, token] of tokens) expect(token, `no access token for ${role}`).not.toBe('');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('path parameters are validated, never passed through to a 500', () => {
  it('holds for every parameterised route, method and role', async () => {
    const routes = parameterisedRoutes();
    // A floor, so a discovery that silently found nothing cannot pass.
    expect(routes.length).toBeGreaterThan(100);

    const failures: string[] = [];
    let calls = 0;

    for (const [role, token] of tokens) {
      for (const [method, path] of routes) {
        for (const value of ['not-a-uuid', randomUUID()]) {
          const url = fill(path, value);
          const client = request(harness.server);
          const response = await client[method](url)
            .set('Authorization', `Bearer ${token}`)
            .send({});
          calls += 1;

          if (response.status >= 500 && !DELIBERATE.has(response.status)) {
            failures.push(
              `${role} ${method.toUpperCase()} ${path} [${value}] → ${String(response.status)}`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
    expect(calls).toBeGreaterThan(400);
  }, 300_000);
});
