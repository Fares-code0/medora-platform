import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * `GET /meta/enums` — API §20.3, RM M27.5.
 *
 * > ✅ Verify: a contract test diffs `/meta/enums` against the frontend
 * > unions and fails on drift.
 *
 * Two diffs, because the endpoint sits between two sources and drift
 * against either one is a different bug.
 *
 * **Against the schema** — complete and automatic. Every enum declared in
 * `prisma/schema/01-enums.prisma` must be served with exactly its `@map`
 * values, in declaration order. This catches the case no frontend diff
 * can see: a migration that added a value the schema does not declare, or
 * a schema value never migrated, which would make the running database
 * and the committed schema disagree about a status vocabulary.
 *
 * **Against the frontend** — for the vocabularies a shell branches on.
 * API §0.3's Appendix B recorded that the server carried
 * `awaiting-patient` (ADR-001) and `draft`/`dispensed` (ADR-002) before
 * the frontend unions did, so this diff used to assert a superset with
 * exactly those extras. The frontend has since adopted all three (FE-10.3
 * and NEW-05), and `PrescriptionStatus` moved to
 * `features/shared-domain/prescriptions/types.ts`. With the planned gap
 * closed, the contract is **set equality**: a value on either side alone
 * is drift. (Set, not order — a union's order carries no meaning; the
 * schema diff above is the one that pins order.)
 */
let harness: AuthHarness;

const FRONTEND_SRC = resolve(__dirname, '../../frontend/src');
const SCHEMA = resolve(__dirname, '../prisma/schema/01-enums.prisma');
const PASSWORD = 'Medora123!';

let token = '';

/** `{ appointment_status: ['scheduled', …], … }`, from the schema file. */
function schemaEnums(): Record<string, string[]> {
  const source = readFileSync(SCHEMA, 'utf8');
  const enums: Record<string, string[]> = {};

  for (const block of source.matchAll(/enum\s+\w+\s*\{([^}]*)\}/g)) {
    const body = block[1] ?? '';
    const name = /@@map\("([a-z_]+)"\)/.exec(body)?.[1];
    if (name === undefined) continue;

    enums[name] = [...body.matchAll(/^\s{2}\w+\s+@map\("([^"]+)"\)$/gm)].map(
      (member) => member[1] ?? '',
    );
  }

  return enums;
}

/** A `'a' | 'b'` union's members, from a frontend type declaration. */
function frontendUnion(file: string, name: string): string[] {
  const source = readFileSync(`${FRONTEND_SRC}/${file}`, 'utf8');
  const start = source.indexOf(`export type ${name} =`);

  expect(start, `${name} not found in ${file}`).toBeGreaterThan(-1);

  const declaration = source.slice(start, source.indexOf(';', start));

  return [...declaration.matchAll(/'([a-z-]+)'/g)].map((match) => match[1] ?? '');
}

beforeAll(async () => {
  harness = await createAuthHarness('meta-m27');

  const email = testEmail('meta-doctor');
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

async function served(): Promise<Record<string, string[]>> {
  const response = await request(harness.server)
    .get('/api/v1/meta/enums')
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);

  return dataOf<{ enums: Record<string, string[]> }>(response).enums;
}

describe('the endpoint', () => {
  it('requires authentication, unlike its neighbours in §20', async () => {
    // `/health` and `/ready` are `@Public()` because a probe that needs a
    // token cannot report that auth is down. §20.3 is `✓`, and sharing
    // that controller would have published the platform's whole status
    // vocabulary to anyone who asked.
    await request(harness.server).get('/api/v1/meta/enums').expect(401);
  });
});

describe('drift against the schema', () => {
  it('serves every declared enum, with its mapped values in order', async () => {
    const enums = await served();
    const declared = schemaEnums();

    // A guard against the extraction quietly matching nothing.
    expect(Object.keys(declared).length).toBeGreaterThan(20);

    for (const [name, members] of Object.entries(declared)) {
      // Order matters: a status machine reads top to bottom, and a
      // sorted diff would report a false difference the first time
      // somebody inserted a value in the middle.
      expect(enums[name], `${name} is declared but not served`).toEqual(members);
    }
  });

  it('serves nothing the schema does not declare', async () => {
    const enums = await served();
    const declared = schemaEnums();

    // The direction that catches a migration adding a value the schema
    // never got — the running database and the committed schema
    // disagreeing about a vocabulary.
    for (const name of Object.keys(enums)) {
      expect(declared[name], `${name} is served but not declared`).toBeDefined();
    }
  });
});

describe('drift against the frontend unions', () => {
  it('agrees on the appointment statuses, ADR-001’s `awaiting-patient` included', async () => {
    const enums = await served();
    const frontend = frontendUnion(
      'features/doctor/appointments/model/types.ts',
      'AppointmentStatus',
    );

    expect(frontend).toContain('awaiting-patient');
    expect([...(enums['appointment_status'] ?? [])].sort()).toEqual([...frontend].sort());
  });

  it('agrees on the prescription statuses, ADR-002’s `draft` and `dispensed` included', async () => {
    const enums = await served();
    const frontend = frontendUnion(
      'features/shared-domain/prescriptions/types.ts',
      'PrescriptionStatus',
    );

    expect(frontend).toEqual(expect.arrayContaining(['draft', 'dispensed']));
    expect([...(enums['prescription_status'] ?? [])].sort()).toEqual([...frontend].sort());
  });

  it('agrees exactly on the appointment priorities', async () => {
    const enums = await served();
    const frontend = frontendUnion(
      'features/doctor/appointments/model/types.ts',
      'AppointmentPriority',
    );

    // No ADR widened this one, so equality is the contract — and this is
    // the assertion that fails if somebody adds a sixth priority to
    // either side alone.
    expect(enums['appointment_priority']).toEqual(frontend);
  });
});
