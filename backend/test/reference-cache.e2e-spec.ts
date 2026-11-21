import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { invalidateReferenceCache } from '../prisma/seed/cache-bust';
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
 * The reference-data cache (RM M31.1) — the formulary, its monographs,
 * the lab catalogue and ICD-10 lookups.
 *
 * > ✅ Verify: cache-bust on formulary edit test.
 *
 * No API route writes these tables; the seed does. Each case therefore
 * reads (priming the cache), changes the row **the way a seed run does —
 * directly in the database**, shows the API still answering from the
 * cache, and then calls `invalidateReferenceCache` — the function both
 * seeds call on exit — and shows the API answering with the new row.
 * The middle step is the proof that the cache is really in front.
 *
 * Every change is undone and re-invalidated in `finally`, because the
 * reference scope is shared by every suite in the run.
 */
let harness: AuthHarness;
let token = '';
let patientId = '';
const charts: string[] = [];

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PASSWORD = 'Medora123!';

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  harness = await createAuthHarness('reference-cache-m311');

  const email = testEmail('ref-doctor');
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const patient = await request(harness.server)
    .post('/api/v1/patients')
    .set(auth())
    .send({
      fullName: 'Reference Cache',
      dateOfBirth: '1985-05-05',
      gender: 'male',
      bloodType: 'O+',
      phone: '+20 100 444 5566',
      allergies: [],
      chronicConditions: [],
    })
    .expect(201);
  patientId = dataOf<{ id: string }>(patient).id;
  charts.push(patientId);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.medicalRecord.deleteMany({
    where: { patient: { publicId: { in: charts } } },
  });
  await harness.prisma.patient.deleteMany({ where: { publicId: { in: charts } } });
  await harness.reset();
  await harness.close();
});

describe('the formulary (verify step: cache-bust on formulary edit)', () => {
  it('serves the list from the cache until the seed invalidates it', async () => {
    const medication = await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
    });
    const read = async () =>
      dataOf<{ items: { id: string; genericName: string }[] }>(
        await request(harness.server).get('/api/v1/medications').query({ q: 'Amoxil' }).set(auth()),
      ).items.find((item) => item.id === medication.id)?.genericName;

    await invalidateReferenceCache();
    expect(await read()).toBe(medication.genericName);

    try {
      await harness.prisma.medication.update({
        where: { id: medication.id },
        data: { genericName: 'Amoxicillin (edited)' },
      });

      expect(await read()).toBe(medication.genericName); // still the cached answer
      expect(await invalidateReferenceCache()).toBe('invalidated');
      expect(await read()).toBe('Amoxicillin (edited)');
    } finally {
      await harness.prisma.medication.update({
        where: { id: medication.id },
        data: { genericName: medication.genericName },
      });
      await invalidateReferenceCache();
    }
  });

  it('serves a monograph from the cache until the seed invalidates it, and never caches a 404', async () => {
    // The seed ships no monographs; this one plays the seed's part.
    const medication = await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Eltroxin' },
    });
    const existing = await harness.prisma.medicationMonograph.findUnique({
      where: { medicationId: medication.id },
    });
    const path = `/api/v1/medications/${medication.id}/monograph`;
    const read = async () =>
      dataOf<{ indications: string | null }>(
        await request(harness.server).get(path).set(auth()).expect(200),
      ).indications;

    try {
      await harness.prisma.medicationMonograph.upsert({
        where: { medicationId: medication.id },
        create: { medicationId: medication.id, indications: 'Hypothyroidism' },
        update: { indications: 'Hypothyroidism' },
      });
      await invalidateReferenceCache();
      expect(await read()).toBe('Hypothyroidism');

      await harness.prisma.medicationMonograph.update({
        where: { medicationId: medication.id },
        data: { indications: 'Edited by the seed' },
      });
      expect(await read()).toBe('Hypothyroidism');

      await invalidateReferenceCache();
      expect(await read()).toBe('Edited by the seed');
    } finally {
      if (existing === null) {
        await harness.prisma.medicationMonograph.delete({ where: { medicationId: medication.id } });
      } else {
        await harness.prisma.medicationMonograph.update({
          where: { medicationId: medication.id },
          data: { indications: existing.indications },
        });
      }
      await invalidateReferenceCache();
    }

    const missing = '00000000-0000-4000-8000-000000000000';
    await request(harness.server)
      .get(`/api/v1/medications/${missing}/monograph`)
      .set(auth())
      .expect(404);
    await request(harness.server)
      .get(`/api/v1/medications/${missing}/monograph`)
      .set(auth())
      .expect(404);
  });
});

describe('the lab catalogue', () => {
  it('serves from the cache until the seed invalidates it', async () => {
    const test = await harness.prisma.labTestCatalogue.findFirstOrThrow({
      where: { code: '51990-0' },
    });
    const read = async () =>
      dataOf<{ items: { code: string; name: string }[] }>(
        await request(harness.server)
          .get('/api/v1/lab-tests/catalogue')
          .query({ q: '51990-0' })
          .set(auth())
          .expect(200),
      ).items.find((item) => item.code === '51990-0')?.name;

    await invalidateReferenceCache();
    expect(await read()).toBe(test.name);

    try {
      await harness.prisma.labTestCatalogue.update({
        where: { id: test.id },
        data: { name: 'BMP (edited)' },
      });
      expect(await read()).toBe(test.name);

      await invalidateReferenceCache();
      expect(await read()).toBe('BMP (edited)');
    } finally {
      await harness.prisma.labTestCatalogue.update({
        where: { id: test.id },
        data: { name: test.name },
      });
      await invalidateReferenceCache();
    }
  });

  it('keeps different queries apart', async () => {
    const all = dataOf<{ totalItems: number }>(
      await request(harness.server).get('/api/v1/lab-tests/catalogue').set(auth()).expect(200),
    ).totalItems;
    const one = dataOf<{ totalItems: number }>(
      await request(harness.server)
        .get('/api/v1/lab-tests/catalogue')
        .query({ q: '51990-0' })
        .set(auth())
        .expect(200),
    ).totalItems;

    expect(one).toBeLessThan(all);
  });
});

describe('ICD-10 lookups on record writes', () => {
  function create(code: string) {
    return request(harness.server)
      .post('/api/v1/medical-records')
      .set(auth())
      .send({
        patientId,
        visitDate: '2026-09-10T09:00:00.000Z',
        visitType: 'Consultation',
        priority: 'normal',
        chiefComplaint: 'Reference cache',
        historyOfPresentIllness: 'None.',
        physicalExamination: 'Normal.',
        diagnoses: [{ code, isPrimary: true }],
      });
  }

  it('honours a code deactivated by the seed only once the seed invalidates', async () => {
    const icd = await harness.prisma.icdCode.findFirstOrThrow({ where: { active: true } });
    await invalidateReferenceCache();
    expect((await create(icd.code)).status).toBe(201); // primes the lookup

    try {
      await harness.prisma.icdCode.update({ where: { id: icd.id }, data: { active: false } });
      expect((await create(icd.code)).status).toBe(201); // the cached id

      await invalidateReferenceCache();
      const refused = await create(icd.code);
      expect(refused.status).toBe(422);
      expect(errorBody(refused).fieldErrors).toHaveProperty('diagnoses');
    } finally {
      await harness.prisma.icdCode.update({ where: { id: icd.id }, data: { active: true } });
      await invalidateReferenceCache();
    }
  });

  it('never caches an unknown code, so a code added by the seed is accepted at once', async () => {
    const code = `Z${String(Date.now()).slice(-6)}`;
    expect((await create(code)).status).toBe(422);

    await harness.prisma.icdCode.create({ data: { code, label: 'Added by the seed' } });
    try {
      expect((await create(code)).status).toBe(201);
    } finally {
      await harness.prisma.recordDiagnosis.deleteMany({ where: { icdCode: { code } } });
      await harness.prisma.icdCode.delete({ where: { code } });
      await invalidateReferenceCache();
    }
  });
});
