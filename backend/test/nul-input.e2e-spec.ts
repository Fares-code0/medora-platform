import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  errorBody,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { destroyLabFixtures, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * A NUL character is a 422, never a 500 (RM M37.2 input abuse).
 *
 * PostgreSQL cannot store U+0000 in text or jsonb, and Zod's `string()`
 * accepts it. Every case below answered **500 `internal_error`** before
 * `RejectNulPipe`, observed on 2026-10-31, including the first, which
 * needs no account.
 */
let harness: AuthHarness;
let doctor = '';
let chart = '';
const charts: string[] = [];

const NUL = 'Ahmed\u0000Hassan';

beforeAll(async () => {
  harness = await createAuthHarness('nul-input');
  doctor = await seedDoctor(harness, 'nul-doctor');
  chart = (await seedPatient(harness, doctor)).id;
  charts.push(chart);
});

afterAll(async () => {
  if (harness === undefined) return;
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

function auth() {
  return { Authorization: `Bearer ${doctor}` };
}

function expectRefused(response: request.Response, field: string): void {
  expect(response.status).toBe(422);
  expect(errorBody(response).code).toBe('validation_failed');
  expect(errorBody(response).fieldErrors).toHaveProperty([field]);
}

describe('a NUL in a request is refused before it reaches the database', () => {
  it('at the public registration route, with nothing created', async () => {
    const email = testEmail('nul-register');
    const response = await request(harness.server)
      .post('/api/v1/auth/register')
      .send(registrationBody({ email, firstName: NUL }));

    expectRefused(response, 'firstName');
    expect(await harness.prisma.user.count({ where: { email } })).toBe(0);
  });

  it('in a clinical write', async () => {
    const response = await request(harness.server)
      .post('/api/v1/medical-records')
      .set(auth())
      .send({
        patientId: chart,
        visitDate: '2026-09-10T09:00:00.000Z',
        visitType: 'Consultation',
        chiefComplaint: NUL,
        historyOfPresentIllness: 'Gradual onset.',
        physicalExamination: 'Unremarkable.',
      });

    expectRefused(response, 'chiefComplaint');
  });

  it('in a nested field, named by its path', async () => {
    const response = await request(harness.server)
      .post('/api/v1/patients')
      .set(auth())
      .send({
        fullName: 'Layla Morsi',
        dateOfBirth: '1988-04-12',
        gender: 'female',
        bloodType: 'A+',
        phone: '+20 100 777 1234',
        allergies: [{ allergen: NUL, severity: 'mild' }],
        chronicConditions: [],
      });

    expectRefused(response, 'allergies[0].allergen');
  });

  it('in a search query', async () => {
    const response = await request(harness.server)
      .get(`/api/v1/patients?q=${encodeURIComponent(NUL)}`)
      .set(auth());

    expectRefused(response, 'q');
  });

  it('in a path parameter', async () => {
    const response = await request(harness.server)
      .get(`/api/v1/patients/${encodeURIComponent('PT-1\u0000')}`)
      .set(auth());

    expectRefused(response, 'patientId');
  });
});

describe('ordinary text is untouched', () => {
  it('still accepts newlines, tabs and non-Latin text in the same fields', async () => {
    const response = await request(harness.server)
      .post('/api/v1/medical-records')
      .set(auth())
      .send({
        patientId: chart,
        visitDate: '2026-09-10T09:00:00.000Z',
        visitType: 'Consultation',
        chiefComplaint: 'صداع مستمر\nfor two weeks\twith nausea',
        historyOfPresentIllness: 'Gradual onset.',
        physicalExamination: 'Unremarkable.',
      });

    expect(response.status).toBe(201);
  });
});
