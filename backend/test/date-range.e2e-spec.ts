import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, errorBody } from './support/auth-app';
import { destroyLabFixtures, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * A date the API cannot represent is a 422, never a 500 (RM M37.2).
 *
 * `z.coerce.date()` accepts years JavaScript can hold, ±275,760, and the
 * database refuses far less. Each refused case below answered **500
 * `internal_error`** as a record's `visitDate` on 2026-10-31.
 */
let harness: AuthHarness;
let doctor = '';
let chart = '';

beforeAll(async () => {
  harness = await createAuthHarness('date-range', { clinicalDoctors: true });
  doctor = await seedDoctor(harness, 'date-doctor');
  chart = (await seedPatient(harness, doctor)).id;
});

afterAll(async () => {
  if (harness === undefined) return;
  await destroyLabFixtures(harness, [chart]);
  await harness.reset();
  await harness.close();
});

function record(visitDate: string): request.Test {
  return request(harness.server)
    .post('/api/v1/medical-records')
    .set('Authorization', `Bearer ${doctor}`)
    .send({
      patientId: chart,
      visitDate,
      visitType: 'Consultation',
      chiefComplaint: 'Persistent headache for two weeks',
      historyOfPresentIllness: 'Gradual onset.',
      physicalExamination: 'Unremarkable.',
    });
}

describe('a date outside 0001–9999', () => {
  for (const visitDate of [
    '+275000-01-01T00:00:00.000Z',
    '-200000-01-01T00:00:00.000Z',
    '-004713-11-24T00:00:00.000Z',
  ]) {
    it(`is refused with 422 naming the field: ${visitDate}`, async () => {
      const response = await record(visitDate);

      expect(response.status).toBe(422);
      expect(errorBody(response).code).toBe('validation_failed');
      expect(errorBody(response).fieldErrors).toHaveProperty(['visitDate']);
    });
  }
});

describe('the ends of the range', () => {
  it('saves 0001-01-01 and 9999-12-31, and serves them back as written', async () => {
    for (const visitDate of ['0001-01-01T00:00:00.000Z', '9999-12-31T00:00:00.000Z']) {
      const response = await record(visitDate);

      expect(response.status).toBe(201);
      expect(JSON.stringify(response.body)).toContain(visitDate.slice(0, 10));
    }
  });
});
