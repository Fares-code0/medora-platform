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
 * RM M41.2 — "payload-size audit of list DTOs" (master guide §15.4:
 * "paginated lists, sparse list DTOs vs full detail DTOs").
 *
 * A mobile client pays for every byte on a metered network and cannot be
 * force-updated, so a list whose size is not bounded by the server is a
 * defect the client cannot work around. The audit therefore asserts the
 * one property that bounds a list's payload — **a paginated list refuses
 * a page larger than its cap** — and measures the rest:
 *
 * - The sweep discovers every parameterless `GET` (as
 *   `timestamps-utc.e2e-spec.ts` does), calls each as a doctor, an
 *   administrator and a patient, and keeps the bodies that are lists:
 *   `data` is `{ items: [...], pageSize }` (paginated) or an array.
 * - **Paginated:** `?pageSize=101` must answer 422 `validation_failed`.
 *   Every list schema caps `pageSize` at 100 (`z.number().max(100)`), so
 *   101 is the first value a correct schema refuses; a list that serves
 *   it, or a thousand, has no server-side bound.
 * - **Measured, not asserted:** identity bytes per body and per item at
 *   the default page size. The numbers depend on fixtures; the report in
 *   `docs/PATIENT_MOBILE_ENABLEMENT.md` records a run. A byte budget per
 *   item would be a product decision nobody has made, so none is
 *   invented here.
 *
 * Unpaginated arrays are listed by the sweep's own output for the same
 * reason: whether a bounded-by-nature list (a user's own sessions, the
 * enum catalogue) needs pagination is a contract question, not a test's.
 *
 * The same sweep also checks every JSON body it reads — lists or not —
 * for **credential material** by key name (API contract audit,
 * 2026-11-14): password and token hashes, encrypted second-factor
 * envelopes, push tokens, API-key hashes and integration secrets are
 * stored, never served. The projections are explicit today; this is what
 * keeps a later `select: undefined` or a spread of a Prisma row from
 * shipping one.
 *
 * GETs only; the fixtures exist so the lists are not empty.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const PAGE_CAP = 100;

const tokens = new Map<string, string>();

/** Column names (camelCase, as Prisma returns them) that must never be serialized. */
const CREDENTIAL_KEYS = new Set([
  'passwordHash',
  'refreshTokenHash',
  'previousTokenHash',
  // ADR-045: the encrypted successor refresh token.
  'successorTokenCt',
  'totpSecretEnc',
  'recoveryCodesEnc',
  'keyHash',
  'pushToken',
  'configEnc',
  'oauthTokensEnc',
  'tokenHash',
]);

/** Every key path in `body` whose key is credential material. */
function credentialKeysIn(body: unknown, at = '$'): string[] {
  if (Array.isArray(body))
    return body.flatMap((item, index) => credentialKeysIn(item, `${at}[${String(index)}]`));
  if (typeof body !== 'object' || body === null) return [];
  return Object.entries(body).flatMap(([key, value]) => [
    ...(CREDENTIAL_KEYS.has(key) ? [`${at}.${key}`] : []),
    ...credentialKeysIn(value, `${at}.${key}`),
  ]);
}
const patientIds: string[] = [];

interface ExpressLayer {
  readonly route?: { readonly path: string; readonly methods: Record<string, boolean> };
}

interface Measurement {
  readonly role: string;
  readonly path: string;
  readonly kind: 'paginated' | 'array';
  readonly items: number;
  readonly bytes: number;
}

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

/** `paginated` for `{ items: [], pageSize }`, `array` for a bare list, else null. */
function listKind(body: unknown): { kind: 'paginated' | 'array'; items: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return { kind: 'array', items: data.length };
  if (typeof data !== 'object' || data === null) return null;
  const record = data as { items?: unknown; pageSize?: unknown };
  if (Array.isArray(record.items) && typeof record.pageSize === 'number') {
    return { kind: 'paginated', items: record.items.length };
  }
  return null;
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

/** ADR-035: an administrator signs in with a second factor. */
async function adminToken(): Promise<string> {
  const email = testEmail('payload-admin');
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
  harness = await createAuthHarness('payload-size');

  const doctor = await seedDoctor(harness, 'payload-doctor');
  for (const fullName of ['Payload One', 'Payload Two', 'Payload Three']) {
    const patient = await seedPatient(harness, doctor, { fullName });
    patientIds.push(patient.id);
    const order = await orderTest(harness, doctor, patient.id);
    await toProcessing(harness, doctor, order.id);
  }
  tokens.set('doctor', doctor);

  const patientEmail = testEmail('payload-patient');
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
  await destroyLabFixtures(harness, patientIds);
  await harness.reset();
  await harness.close();
});

describe('the sweep’s own rule', () => {
  it('finds credential keys at any depth, and nothing else', () => {
    expect(credentialKeysIn({ data: { items: [{ id: 'x', pushToken: 't' }] } })).toEqual([
      '$.data.items[0].pushToken',
    ]);
    expect(credentialKeysIn({ data: { user: { passwordHash: 'h' } } })).toEqual([
      '$.data.user.passwordHash',
    ]);
    expect(credentialKeysIn({ data: { hasPushToken: true, token: 'not-a-hash' } })).toEqual([]);
  });
});

describe('M41.2 — payload-size audit of list DTOs', () => {
  it('every paginated list refuses a page above its cap, for every role that can read it', async () => {
    const paths = parameterlessGets();
    expect(paths.length).toBeGreaterThan(50);

    const measured: Measurement[] = [];
    const unbounded: string[] = [];
    const exposed: string[] = [];
    let jsonBodies = 0;

    for (const [role, token] of tokens) {
      for (const path of paths) {
        const response = await request(harness.server)
          .get(path)
          .set('Authorization', `Bearer ${token}`);
        if (response.status !== 200 || !response.type.includes('json')) continue;

        jsonBodies += 1;
        exposed.push(...credentialKeysIn(response.body).map((key) => `${role} GET ${path} ${key}`));

        const list = listKind(response.body);
        if (list === null) continue;

        measured.push({
          role,
          path,
          kind: list.kind,
          items: list.items,
          bytes: Buffer.byteLength(JSON.stringify(response.body)),
        });

        if (list.kind !== 'paginated') continue;

        const oversized = await request(harness.server)
          .get(path)
          .query({ pageSize: PAGE_CAP + 1 })
          .set('Authorization', `Bearer ${token}`);
        if (oversized.status !== 422) {
          unbounded.push(
            `${role} GET ${path}?pageSize=${String(PAGE_CAP + 1)} → ${String(oversized.status)}`,
          );
        }
      }
    }

    // The report: one line per list, so a run's numbers can be copied into
    // the mobile enablement doc.
    const rows = measured
      .map(
        (row) =>
          `${row.kind.padEnd(9)} ${row.role.padEnd(7)} ${row.path.padEnd(48)} items=${String(row.items).padStart(3)} bytes=${String(row.bytes).padStart(6)} perItem=${row.items === 0 ? '—' : String(Math.round(row.bytes / row.items))}`,
      )
      .join('\n');
    console.log(`[M41.2 payload audit]\n${rows}`);

    expect(unbounded).toEqual([]);
    expect(exposed).toEqual([]);
    expect(jsonBodies).toBeGreaterThan(60);
    // Floors: a sweep that found no lists, or only empty ones, proves nothing.
    expect(measured.filter((row) => row.kind === 'paginated').length).toBeGreaterThan(10);
    expect(measured.filter((row) => row.items > 0).length).toBeGreaterThan(10);
  }, 180_000);
});
