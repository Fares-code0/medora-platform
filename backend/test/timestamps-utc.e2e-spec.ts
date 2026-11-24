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
import {
  PASSWORD,
  destroyLabFixtures,
  orderTest,
  seedDoctor,
  seedPatient,
  toProcessing,
} from './support/lab-fixture';

/**
 * RM M41.2 — "timestamps all UTC in contract tests".
 *
 * A mobile client renders an instant in the device's own timezone, so
 * the API must send instants it can parse without guessing: ISO-8601 in
 * UTC, `Z`-suffixed. A naive `2026-10-30T09:00:00` is read as *local*
 * time by `new Date()` on every platform, which is wrong by the device's
 * offset and silently so; an offset other than `Z` is legal ISO but is
 * not what the contract promises.
 *
 * ## Why a sweep, not a list
 *
 * A hand-kept list of "the endpoints with dates" is only as complete as
 * the last person to remember one. So the suite discovers every
 * parameterless `GET` Express serves — the same discovery
 * `authz-route-matrix.e2e-spec.ts` proves complete — calls each as every
 * staff role and a patient, and walks every JSON body it is given.
 * Routes with path parameters are left out: a placeholder id answers 404
 * and proves nothing, and the list routes return the same view types.
 *
 * ## What counts as a timestamp
 *
 * - Any string that *starts like* a date-time (`YYYY-MM-DD` then `T` or a
 *   space, then `hh:mm`) must be strict UTC:
 *   `YYYY-MM-DDThh:mm:ss[.sss]Z`. Date-only values (`dateOfBirth`) and
 *   times of day (`09:00`) are not instants and are not matched.
 * - Any field named `…At` must be such a string or `null` — an instant
 *   sent as epoch milliseconds is not ISO-8601 at all.
 * - A `cursor` is opaque, even when it begins with an instant (the audit
 *   cursor is `<occurredAt>|<id>`), and is not read.
 *
 * GETs only, so nothing is written by the sweep itself; the fixtures
 * below exist so the lists are not empty.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const LOOKS_LIKE_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

const STAFF_ROLES = ['reception', 'laboratory', 'pharmacy'] as const;

const tokens = new Map<string, string>();
const patientIds: string[] = [];

interface ExpressLayer {
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean> };
}

/** Every parameterless GET path Express serves, under the API prefix. */
function parameterlessGets(): string[] {
  const express = harness.app.getHttpAdapter().getInstance() as {
    _router: { stack: ExpressLayer[] };
  };

  return express._router.stack
    .map((layer) => layer.route)
    .filter((route) => route !== undefined)
    .filter((route) => route.methods.get === true)
    .map((route) => route.path)
    .filter((path) => path.startsWith(`${PREFIX}/`) && !/[:*$]/.test(path));
}

/** Every value in `body` that breaks the rule, as `path: value`. */
function violationsIn(body: unknown, at = '$'): string[] {
  if (typeof body === 'string') {
    return LOOKS_LIKE_DATE_TIME.test(body) && !UTC_INSTANT.test(body) ? [`${at}: ${body}`] : [];
  }

  if (Array.isArray(body))
    return body.flatMap((item, index) => violationsIn(item, `${at}[${index}]`));

  if (typeof body !== 'object' || body === null) return [];

  return Object.entries(body).flatMap(([key, value]) => {
    const path = `${at}.${key}`;
    if (/cursor$/i.test(key)) return [];
    if (/At$/.test(key) && value !== null && typeof value !== 'string') {
      return [`${path}: ${JSON.stringify(value)} is not an ISO-8601 string`];
    }
    if (/At$/.test(key) && typeof value === 'string' && !UTC_INSTANT.test(value)) {
      return [`${path}: ${value}`];
    }
    return violationsIn(value, path);
  });
}

/** How many instants a body carries — so an empty sweep cannot pass. */
function instantsIn(body: unknown): number {
  if (typeof body === 'string') return UTC_INSTANT.test(body) ? 1 : 0;
  if (Array.isArray(body)) return body.reduce<number>((sum, item) => sum + instantsIn(item), 0);
  if (typeof body !== 'object' || body === null) return 0;
  return Object.values(body).reduce<number>((sum, value) => sum + instantsIn(value), 0);
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

async function setRole(email: string, code: string): Promise<void> {
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: role.id } });
}

/** ADR-035: an administrator signs in with a second factor. */
async function adminToken(): Promise<string> {
  const email = testEmail('utc-admin');
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
  await setRole(email, 'admin');

  const { otpToken } = await login(email);
  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${PREFIX}/auth/otp/verify`)
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

beforeAll(async () => {
  harness = await createAuthHarness('timestamps-utc', { clinicalDoctors: true });

  // A doctor with a chart and a lab order part-way through its pipeline,
  // so the clinical lists carry timeline and workflow instants.
  const doctor = await seedDoctor(harness, 'utc-doctor');
  const patient = await seedPatient(harness, doctor, { fullName: 'Utc Sweep' });
  patientIds.push(patient.id);
  const order = await orderTest(harness, doctor, patient.id);
  await toProcessing(harness, doctor, order.id);
  tokens.set('doctor', doctor);

  const patientEmail = testEmail('utc-patient');
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(patientRegistrationBody({ email: patientEmail }));
  await markVerified(harness.prisma, patientEmail);
  tokens.set('patient', (await login(patientEmail)).accessToken ?? '');

  for (const role of STAFF_ROLES) {
    const email = testEmail(`utc-${role}`);
    await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);
    await setRole(email, role);
    tokens.set(role, (await login(email)).accessToken ?? '');
  }

  tokens.set('admin', await adminToken());

  for (const [role, token] of tokens) expect(token, `no access token for ${role}`).not.toBe('');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await destroyLabFixtures(harness, patientIds);
  await harness.reset();
  await harness.close();
});

describe('M41.2 — every instant the API serves is ISO-8601 UTC', () => {
  it('holds for every parameterless GET, as every role', async () => {
    const paths = parameterlessGets();
    // A floor, so a discovery that silently found nothing cannot pass.
    expect(paths.length).toBeGreaterThan(50);

    const violations: string[] = [];
    let instants = 0;
    let bodies = 0;

    for (const [role, token] of tokens) {
      for (const path of paths) {
        const response = await request(harness.server)
          .get(path)
          .set('Authorization', `Bearer ${token}`);

        if (response.status !== 200 || !response.type.includes('json')) continue;

        bodies += 1;
        instants += instantsIn(response.body);
        violations.push(...violationsIn(response.body).map((v) => `${role} GET ${path} ${v}`));
      }
    }

    expect(violations).toEqual([]);
    // Floors for the same reason: a sweep whose every call was refused,
    // or whose lists were all empty, would assert nothing.
    expect(bodies).toBeGreaterThan(60);
    expect(instants).toBeGreaterThan(100);
  }, 120_000);
});

describe('the sweep’s own rule', () => {
  it('refuses naive, offset and epoch instants, and accepts UTC', () => {
    expect(violationsIn({ at: '2026-10-30T09:00:00' })).toHaveLength(1);
    expect(violationsIn({ at: '2026-10-30T09:00:00+03:00' })).toHaveLength(1);
    expect(violationsIn({ at: '2026-10-30 09:00' })).toHaveLength(1);
    expect(violationsIn({ createdAt: 1793391247383 })).toHaveLength(1);
    expect(violationsIn({ createdAt: '2026-10-30' })).toHaveLength(1);

    expect(violationsIn({ createdAt: '2026-10-30T09:00:00.000Z', deletedAt: null })).toEqual([]);
    expect(violationsIn({ dateOfBirth: '1988-04-12', opensAt: null, time: '09:00' })).toEqual([]);
    expect(violationsIn({ nextCursor: '2026-10-30T09:00:00.000Z|3112eaee' })).toEqual([]);
  });
});
