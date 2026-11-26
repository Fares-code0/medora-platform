/**
 * Patient-facing discovery (contract §2): the hospital directory and the
 * additive `hospitalId` filter / `hospital` badge on `/patient/doctors`.
 * Active rows only; organisational fields only; patients only.
 */

import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { body as mailBody } from './support/smtp-sink';

const PREFIX = '/api/v1';
const PASSWORD = 'Medora123!';

let harness: AuthHarness;
let hospital: string;
let otherHospital: string;
let inactiveHospital: string;
let patient: string;
let doctorToken: string;
let doctorId: string;
let specialty: { id: string; name: string };

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(`${PREFIX}/auth/login`)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function clearOrg(ids: readonly string[]): Promise<void> {
  const db = harness.prisma;
  await db.clinic.deleteMany({ where: { hospitalId: { in: [...ids] } } });
  await db.hospitalLocation.deleteMany({ where: { hospitalId: { in: [...ids] } } });
  await db.hospitalDepartment.deleteMany({ where: { hospitalId: { in: [...ids] } } });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-hospital-discovery');
  hospital = await fixtureHospital(harness.prisma, 'disc');
  otherHospital = await fixtureHospital(harness.prisma, 'disco');
  inactiveHospital = await fixtureHospital(harness.prisma, 'discx');
  await harness.prisma.hospital.update({ where: { id: inactiveHospital }, data: { status: 'INACTIVE' } });
  await clearOrg([hospital, otherHospital, inactiveHospital]);

  await harness.prisma.clinic.createMany({
    data: [
      { publicId: `cln_${randomUUID()}`, hospitalId: hospital, name: 'Cardiology Clinic' },
      { publicId: `cln_${randomUUID()}`, hospitalId: hospital, name: 'Closed Clinic', status: 'INACTIVE' },
    ],
  });
  await harness.prisma.hospitalLocation.create({
    data: {
      hospitalId: hospital,
      name: 'Main Campus',
      addressLine1: '1 Nile Street',
      city: 'Cairo',
      countryCode: 'EG',
      timezone: 'Africa/Cairo',
    },
  });
  await harness.prisma.hospitalDepartment.createMany({
    data: [
      { hospitalId: hospital, name: 'Cardiology' },
      { hospitalId: hospital, name: 'Old Wing', status: 'INACTIVE' },
    ],
  });

  const doctorEmail = testEmail('doctor');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email: doctorEmail }));
  await markVerified(harness.prisma, doctorEmail);
  doctorId = (await makeClinicalDoctor(harness.prisma, doctorEmail, hospital)).doctorId;
  doctorToken = await login(doctorEmail);
  specialty = await harness.prisma.specialty.findFirstOrThrow({
    where: { active: true },
    select: { id: true, name: true },
  });
  await harness.prisma.doctorSpecialty.create({ data: { doctorId, specialtyId: specialty.id } });

  const patientEmail = testEmail('patient');
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(registrationBody({ email: patientEmail, role: 'patient' }))
    .expect(201);
  await request(harness.server)
    .post(`${PREFIX}/auth/verify-email`)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(patientEmail)!)) })
    .expect(204);
  patient = await login(patientEmail);
}, 120_000);

afterAll(async () => {
  await harness.prisma.doctorSpecialty.deleteMany({ where: { doctorId } });
  await harness.reset();
  await clearOrg([hospital, otherHospital, inactiveHospital]);
  await harness.close();
});

describe('GET /patient/hospitals', () => {
  it('lists active hospitals with active clinic and department counts and a city', async () => {
    const response = await request(harness.server)
      .get(`${PREFIX}/patient/hospitals?q=${encodeURIComponent('E2E Fixture Hospital DISC')}&pageSize=100`)
      .set(as(patient));
    expect(response.status).toBe(200);
    const page = dataOf<{ items: Record<string, unknown>[]; totalItems: number }>(response);
    const ids = page.items.map((item) => item['id']);
    expect(ids).toContain(hospital);
    expect(ids).toContain(otherHospital);
    expect(ids).not.toContain(inactiveHospital);

    expect(page.items.find((item) => item['id'] === hospital)).toEqual({
      id: hospital,
      name: 'E2E Fixture Hospital DISC',
      city: 'Cairo',
      clinicCount: 1,
      departmentCount: 1,
    });
    expect(page.items.find((item) => item['id'] === otherHospital)).toMatchObject({
      city: null,
      clinicCount: 0,
      departmentCount: 0,
    });
  });

  it('answers 403 patient_only to a non-patient', async () => {
    const response = await request(harness.server).get(`${PREFIX}/patient/hospitals`).set(as(doctorToken));
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('patient_only');
  });
});

describe('GET /patient/hospitals/:id', () => {
  it('returns organisational detail only, active children only, description null', async () => {
    const response = await request(harness.server).get(`${PREFIX}/patient/hospitals/${hospital}`).set(as(patient));
    expect(response.status).toBe(200);
    const body = dataOf<Record<string, unknown>>(response);
    expect(Object.keys(body).sort()).toEqual(
      ['id', 'name', 'description', 'phone', 'clinics', 'locations', 'departments', 'specialties'].sort(),
    );
    expect(body['description']).toBeNull();
    expect(body['clinics']).toEqual([{ id: expect.any(String), name: 'Cardiology Clinic' }]);
    expect(body['departments']).toEqual([{ id: expect.any(String), name: 'Cardiology' }]);
    expect(body['locations']).toEqual([
      {
        id: expect.any(String),
        name: 'Main Campus',
        addressLine: '1 Nile Street',
        city: 'Cairo',
        timezone: 'Africa/Cairo',
      },
    ]);
    expect(body['specialties']).toContainEqual(specialty);
  });

  it('answers 404 for an inactive, unknown or malformed id alike', async () => {
    for (const id of [inactiveHospital, randomUUID(), 'not-a-uuid']) {
      const response = await request(harness.server).get(`${PREFIX}/patient/hospitals/${id}`).set(as(patient));
      expect(response.status).toBe(404);
    }
  });
});

describe('GET /patient/doctors — hospital filter and badge (additive)', () => {
  it('filters by hospitalId and names the hospital on each summary', async () => {
    const response = await request(harness.server)
      .get(`${PREFIX}/patient/doctors?hospitalId=${hospital}&pageSize=100`)
      .set(as(patient));
    expect(response.status).toBe(200);
    const items = dataOf<{ items: Record<string, unknown>[] }>(response).items;
    const mine = items.find((item) => item['id'] === doctorId);
    expect(mine).toBeDefined();
    expect(mine!['hospital']).toEqual({ id: hospital, name: 'E2E Fixture Hospital DISC' });
    // Existing fields are unchanged.
    for (const key of ['fullName', 'title', 'specialty', 'departmentName', 'photoUrl', 'yearsOfExperience', 'languages', 'ratingAvg']) {
      expect(mine).toHaveProperty(key);
    }
    for (const item of items) expect(item['hospital']).toEqual({ id: hospital, name: 'E2E Fixture Hospital DISC' });

    const elsewhere = await request(harness.server)
      .get(`${PREFIX}/patient/doctors?hospitalId=${otherHospital}&pageSize=100`)
      .set(as(patient));
    const ids = dataOf<{ items: { id: string }[] }>(elsewhere).items.map((item) => item.id);
    expect(ids).not.toContain(doctorId);
  });

  it('carries the hospital on the detail too, and rejects a malformed hospitalId', async () => {
    const detail = await request(harness.server).get(`${PREFIX}/patient/doctors/${doctorId}`).set(as(patient));
    expect(dataOf<Record<string, unknown>>(detail)['hospital']).toEqual({
      id: hospital,
      name: 'E2E Fixture Hospital DISC',
    });

    const bad = await request(harness.server).get(`${PREFIX}/patient/doctors?hospitalId=nope`).set(as(patient));
    expect(bad.status).toBe(422);
  });
});
