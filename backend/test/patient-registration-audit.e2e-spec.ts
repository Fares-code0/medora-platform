/**
 * Security remediation L1 — a patient's registration and its audit evidence
 * are one transaction.
 *
 * Registering a patient is the moment the chart comes to belong to the
 * registering doctor's hospital: its Hospital Medical Record and primary care
 * assignment are created with it. The `patient.create` audit row is that
 * ownership's evidence. It used to be written after the transaction had
 * committed, so a failed audit write left an owned chart with no record of
 * who created it, where, or when. It is now written inside the registration
 * transaction through the throwing writer.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import { type AuditEvent, TransactionalAuditWriter } from '../src/shared/audit';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
} from './support/auth-app';

const PASSWORD = 'Medora123!';
const created: string[] = [];
let harness: AuthHarness;

async function signInDoctor(target: AuthHarness, local: string): Promise<string> {
  const email = testEmail(local);
  await request(target.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(target.prisma, email);
  await makeClinicalDoctor(target.prisma, email, await fixtureHospital(target.prisma, 'a'));
  return dataOf<{ accessToken: string }>(
    await request(target.server).post('/api/v1/auth/login').send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

function register(target: AuthHarness, token: string, fullName: string) {
  return request(target.server)
    .post('/api/v1/patients')
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName,
      dateOfBirth: '1990-02-03',
      gender: 'female',
      bloodType: 'O+',
      phone: '+20 100 555 0101',
      allergies: [{ allergen: 'Latex', severity: 'mild', reaction: 'Rash' }],
      chronicConditions: [],
    });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-registration-audit');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  const patients = await harness.prisma.patient.findMany({
    where: { OR: [{ publicId: { in: created } }, { fullName: { startsWith: 'L1 Probe' } }] },
    select: { id: true },
  });
  await purgeHospitalRecords(
    harness.prisma,
    patients.map((row) => row.id),
  );
  await harness.prisma.patient.deleteMany({ where: { id: { in: patients.map((row) => row.id) } } });
  await harness.reset();
  await harness.close();
});

describe('patient registration and its audit evidence (L1)', () => {
  it('writes exactly one patient.create row, attributed to the registering hospital', async () => {
    const token = await signInDoctor(harness, 'l1-ok');
    const response = await register(harness, token, 'L1 Probe Recorded');
    expect(response.status).toBe(201);
    const publicId = dataOf<{ id: string }>(response).id;
    created.push(publicId);

    const rows = await harness.prisma.auditEvent.findMany({
      where: { eventType: 'patient.create', target: { contains: publicId } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hospitalId).toBe(await fixtureHospital(harness.prisma, 'a'));
    expect(rows[0]?.payload).toMatchObject({ medicalRecordOpened: true, careAssignment: 'primary' });
  });

  it('creates no chart, record or care assignment when the audit row cannot be written', async () => {
    // The real writer on the real transaction, handed a `patient.create`
    // event Postgres rejects (`session_id` is a uuid column); every other
    // event is written normally.
    class RefusesRegistrationEvidence extends TransactionalAuditWriter {
      override recordWithin(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
        return super.recordWithin(
          tx,
          event.action === 'patient.create' ? { ...event, actor: { ...event.actor, sessionId: 'not-a-uuid' } } : event,
        );
      }
    }
    const failing = await createAuthHarness('patient-registration-audit-fail', {
      overrides: [{ token: TransactionalAuditWriter, value: new RefusesRegistrationEvidence() }],
    });
    try {
      const token = await signInDoctor(failing, 'l1-fail');
      const response = await register(failing, token, 'L1 Probe Unrecorded');

      expect(response.status, JSON.stringify(response.body)).toBe(503);
      expect(errorBody(response).code).toBe('audit_unavailable');
      // Rolled back with the audit row: nothing owned without its evidence.
      expect(await harness.prisma.patient.count({ where: { fullName: 'L1 Probe Unrecorded' } })).toBe(0);
      expect(
        await harness.prisma.hospitalMedicalRecord.count({ where: { patient: { fullName: 'L1 Probe Unrecorded' } } }),
      ).toBe(0);
    } finally {
      await failing.reset();
      await failing.close();
    }
  });
});
