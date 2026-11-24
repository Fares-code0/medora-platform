/**
 * Mandatory PHI-read audit (multi-hospital §2.13; audit findings F-02, F-03).
 *
 * 1. **Inventory.** Every authenticated read route carries an explicit
 *    classification — `@PhiRead(…)` or `@NotPhi(…)`, never both, never
 *    neither. A new read endpoint cannot ship unaudited by omission: this
 *    suite fails until someone states what it returns.
 * 2. **Exactly one event per PHI read**, attributed to the reader's
 *    hospital, naming the route and the resource; nested patient resources
 *    included.
 * 3. **No false event** for a route classified `@NotPhi`.
 * 4. **Fail-closed.** When the ledger refuses the write, the read answers
 *    503 `audit_unavailable` and the data is never sent — for the
 *    interceptor-audited routes and for a handler-audited one alike.
 *
 * Break-Glass and information-request reads are asserted in
 * `controlled-access.e2e-spec.ts`; downloads (`file.download`) in
 * `patient-documents.e2e-spec.ts` and `record-attachments.e2e-spec.ts`.
 */

import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IS_PUBLIC_KEY, NOT_PHI_METADATA, PHI_READ_METADATA } from '../src/shared/authz';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  makeClinicalDoctor,
  markVerified,
  recordPatientAt,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

const TAG = 'phr';
const PASSWORD = 'Medora123!';

let harness: AuthHarness;
let token = '';
let doctorUserId = '';
let hospitalId = '';
let patientPublicId = '';

const as = () => ({ Authorization: `Bearer ${token}` });
const reflector = new Reflector();

interface ReadRoute {
  readonly key: string;
  readonly phi: boolean;
  readonly notPhi: boolean;
}

function asList(value: unknown): string[] {
  if (value === undefined) return [''];
  return Array.isArray(value) ? (value as string[]) : [value as string];
}

function readRoutes(): ReadRoute[] {
  const routes: ReadRoute[] = [];
  const seen = new Set<Type>();
  for (const module of harness.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as Type | null;
      if (controller === null || seen.has(controller)) continue;
      seen.add(controller);
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        const targets = [handler, controller];
        if (reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) continue;
        for (const base of asList(Reflect.getMetadata(PATH_METADATA, controller))) {
          for (const own of asList(Reflect.getMetadata(PATH_METADATA, handler))) {
            routes.push({
              key: `GET /${[base, own].filter((part) => part !== '' && part !== '/').join('/')} (${controller.name}.${name})`,
              phi: reflector.getAllAndOverride(PHI_READ_METADATA, targets) !== undefined,
              notPhi: reflector.getAllAndOverride(NOT_PHI_METADATA, targets) !== undefined,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.key.localeCompare(b.key));
}

const phiReads = () =>
  harness.prisma.auditEvent.findMany({
    where: { eventType: 'phi.read', actorId: doctorUserId },
    orderBy: { occurredAt: 'asc' },
  });

/** Makes the ledger refuse this doctor's `event_type` rows, as an outage would. */
async function refuseLedger(eventType: string): Promise<void> {
  await harness.prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_phr_refuse_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.actor_id = '${doctorUserId}'::uuid AND NEW.event_type = '${eventType}' THEN
        RAISE EXCEPTION 'ledger unavailable (test)';
      END IF;
      RETURN NEW;
    END $$`);
  await harness.prisma.$executeRawUnsafe(
    'CREATE TRIGGER phr_refuse BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION test_phr_refuse_ledger()',
  );
}

async function restoreLedger(): Promise<void> {
  await harness.prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS phr_refuse ON audit_events');
  await harness.prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_phr_refuse_ledger()');
}

beforeAll(async () => {
  harness = await createAuthHarness('phi-read-audit');
  await restoreLedger();
  const email = testEmail('phr-doctor');
  expect((await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }))).status).toBe(
    201,
  );
  await markVerified(harness.prisma, email);
  hospitalId = (await makeClinicalDoctor(harness.prisma, email)).hospitalId;
  doctorUserId = (await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
  const login = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  token = dataOf<{ accessToken: string }>(login).accessToken;

  const [patient] = await createPatientRecords(harness.prisma, TAG, 1);
  if (patient === undefined) throw new Error('fixture patient missing');
  await recordPatientAt(harness.prisma, patient.id, hospitalId);
  patientPublicId = patient.publicId;
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await restoreLedger();
  await destroyPatientRecords(harness.prisma, TAG);
  await harness.reset();
  await harness.close();
});

describe('PHI-read classification inventory', () => {
  it('discovers the read routes', () => {
    expect(readRoutes().length).toBeGreaterThan(100);
  });

  it('classifies every authenticated read route explicitly', () => {
    const unclassified = readRoutes()
      .filter((route) => !route.phi && !route.notPhi)
      .map((route) => route.key);
    expect(unclassified).toEqual([]);
  });

  it('never classifies a route both ways', () => {
    const both = readRoutes()
      .filter((route) => route.phi && route.notPhi)
      .map((route) => route.key);
    expect(both).toEqual([]);
  });
});

describe('PHI-read audit events', () => {
  it('writes exactly one phi.read per successful PHI read, attributed and named', async () => {
    const before = (await phiReads()).length;
    const response = await request(harness.server).get(`/api/v1/patients/${patientPublicId}/vitals`).set(as());
    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const rows = await phiReads();
    expect(rows.length).toBe(before + 1);
    const row = rows.at(-1);
    expect(row?.hospitalId).toBe(hospitalId);
    expect(row?.target).toBe(`vital_signs:${patientPublicId}`);
    expect(row?.payload).toMatchObject({ route: '/api/v1/patients/:patientId/vitals', method: 'GET' });
  });

  it('audits each nested patient resource it serves', async () => {
    for (const tab of ['notes', 'medications', 'documents', 'history']) {
      const before = (await phiReads()).length;
      const response = await request(harness.server).get(`/api/v1/patients/${patientPublicId}/${tab}`).set(as());
      expect(response.status, `${tab}: ${JSON.stringify(response.body)}`).toBe(200);
      expect((await phiReads()).length, tab).toBe(before + 1);
    }
  });

  it('attributes a handler-written disclosure (patient.view) to the reader’s hospital and session, once', async () => {
    const views = () =>
      harness.prisma.auditEvent.findMany({ where: { eventType: 'patient.view', actorId: doctorUserId } });
    const before = (await views()).length;
    const phiBefore = (await phiReads()).length;
    expect((await request(harness.server).get(`/api/v1/patients/${patientPublicId}`).set(as())).status).toBe(200);
    const rows = await views();
    expect(rows.length).toBe(before + 1);
    expect(rows.every((row) => row.hospitalId === hospitalId)).toBe(true);
    expect(rows.every((row) => row.sessionId !== null)).toBe(true);
    // Handler-audited: no second, interceptor-written event for the same read.
    expect((await phiReads()).length).toBe(phiBefore);
  });

  it('writes no phi.read for a route classified @NotPhi', async () => {
    const before = (await phiReads()).length;
    const response = await request(harness.server).get('/api/v1/medications').set(as());
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await phiReads()).length).toBe(before);
  });

  it('writes nothing for a refused read: no disclosure happened', async () => {
    const before = (await phiReads()).length;
    const response = await request(harness.server).get('/api/v1/patients/PT-DOES-NOT-EXIST/vitals').set(as());
    expect(response.status).toBe(404);
    expect((await phiReads()).length).toBe(before);
  });
});

describe('fail-closed when the ledger refuses the write', () => {
  it('answers 503 and withholds the data of an interceptor-audited read', async () => {
    await refuseLedger('phi.read');
    try {
      const response = await request(harness.server).get(`/api/v1/patients/${patientPublicId}/vitals`).set(as());
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).toContain('audit_unavailable');
      expect(response.body).not.toHaveProperty('data');
    } finally {
      await restoreLedger();
    }
  });

  it('answers 503 and withholds the patient of a handler-audited read', async () => {
    await refuseLedger('patient.view');
    try {
      const response = await request(harness.server).get(`/api/v1/patients/${patientPublicId}`).set(as());
      expect(response.status).toBe(503);
      expect(JSON.stringify(response.body)).not.toContain(patientPublicId);
    } finally {
      await restoreLedger();
    }
    // And the read works again once the ledger does.
    expect((await request(harness.server).get(`/api/v1/patients/${patientPublicId}`).set(as())).status).toBe(200);
  });
});
